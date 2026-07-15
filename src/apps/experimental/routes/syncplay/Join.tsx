import React, { type FC, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import Page from 'components/Page';
import { pluginManager } from 'components/pluginManager';
import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { PluginType } from 'types/plugin';

interface SyncPlayQueueCoreLike {
    startPlayback: (apiClient: unknown) => void
}

interface SyncPlayManagerLike {
    joinGroupExplicit: (groupId: string) => Promise<void>
    isPlaylistEmpty: () => boolean
    isPlaybackActive: () => boolean
    getApiClient: () => unknown
    getQueueCore: () => SyncPlayQueueCoreLike
}

interface SyncPlayHelperLike {
    // Resolves with the raw event-callback `arguments` (index 0 is the event object itself,
    // index 1+ are whatever args the trigger call passed), or rejects on timeout/reject-event.
    waitForEventOnce: (emitter: unknown, eventType: string, timeout?: number, rejectEventTypes?: string[]) => Promise<unknown[]>
    WaitForEventDefaultTimeout: number
}

interface SyncPlayInstance {
    Manager: SyncPlayManagerLike
    Helper: SyncPlayHelperLike
}

// ConnectionRequired only guarantees a signed-in *connection*; it validates
// that via ServerConnections.currentApiClient() directly and flips its own
// isLoading gate as soon as that resolves. The `api` instance from useApi(),
// by contrast, is populated by ApiProvider through a separate async chain
// (getCurrentUser() -> setLegacyApiClient() -> a second effect that derives
// `api` from it) that is not synchronized with ConnectionRequired's gate at
// all. So this page can render with `api` still undefined for a render or
// two after mount. Give it a bounded amount of time to show up instead of
// treating "not ready yet" as a permanent failure.
const API_WAIT_TIMEOUT_MS = 8000;

// Bounded wait for the joined group's queue snapshot -- a 'PlayQueue' GroupUpdate that the
// server sends as a separate websocket message right after 'GroupJoined' -- to actually be
// processed. Without this, checking isPlaylistEmpty() immediately after joinGroupExplicit()
// resolves would almost always see the stale pre-join state (empty) and misclassify an
// active group as a waiting room, since that snapshot hasn't arrived yet.
const QUEUE_SNAPSHOT_WAIT_MS = 5000;

/**
 * "Magic link" join page for SyncPlay. Reads `groupId`/`itemId` from the
 * query string, joins the group, and lands on the item's details page
 * (or home) while SyncPlay's own machinery takes over player navigation.
 */
const SyncPlayJoinPage: FC = () => {
    const [ searchParams ] = useSearchParams();
    const navigate = useNavigate();
    const { api } = useApi();
    const hasRedirected = useRef(false);

    const groupId = searchParams.get('groupId');
    const itemId = searchParams.get('itemId') ?? undefined;

    useEffect(() => {
        let isCancelled = false;

        const redirectToLanding = () => {
            if (hasRedirected.current) return;
            hasRedirected.current = true;
            navigate(itemId ? `/details?id=${itemId}` : '/home');
        };

        if (!groupId) {
            console.error('[SyncPlayJoin] missing groupId, redirecting');
            redirectToLanding();
            return;
        }

        if (!api) {
            // Not necessarily a failure -- the api instance may simply not have
            // finished initializing yet (see API_WAIT_TIMEOUT_MS comment above).
            // This effect re-runs (via the `api` dependency below) as soon as it
            // becomes available, so just wait -- bounded by a timeout in case it
            // genuinely never shows up.
            console.debug('[SyncPlayJoin] api instance not ready yet, waiting');
            const timeoutId = setTimeout(() => {
                if (isCancelled) return;
                console.error('[SyncPlayJoin] timed out waiting for api instance, redirecting');
                redirectToLanding();
            }, API_WAIT_TIMEOUT_MS);

            return () => {
                isCancelled = true;
                clearTimeout(timeoutId);
            };
        }

        const syncPlay: SyncPlayInstance | undefined = pluginManager.firstOfType(PluginType.SyncPlay)?.instance;
        if (!syncPlay) {
            console.error('[SyncPlayJoin] SyncPlay plugin not available, redirecting');
            redirectToLanding();
            return;
        }

        // Waits (bounded) for the local player to actually start after an attach attempt,
        // pulled out to a top-level function (rather than nested inside the queue-snapshot
        // handler below) purely to keep callback nesting shallow.
        const waitForPlaybackAttach = () => {
            syncPlay.Helper.waitForEventOnce(syncPlay.Manager, 'playbackstart', syncPlay.Helper.WaitForEventDefaultTimeout)
                .then(() => {
                    // Already carried to the video route by the mechanism described above;
                    // just stop this page from redirecting anywhere itself.
                    hasRedirected.current = true;
                })
                .catch((err) => {
                    // QueueCore.startPlayback() navigates to the video OSD as soon as the
                    // attach begins (so a slow stream start still leaves the user with full
                    // player chrome). If we're already there, a redirect now would yank a
                    // merely slow-loading player out from under the user -- stay put and let
                    // SyncPlay's own stall retry/halt handling deal with the player.
                    if (window.location.hash.startsWith('#/video')) {
                        console.warn('[SyncPlayJoin] player attach still pending, already on the video OSD; not redirecting', err);
                        hasRedirected.current = true;
                        return;
                    }
                    console.error('[SyncPlayJoin] timed out attaching local player to group, landing on details page', err);
                    if (!isCancelled) redirectToLanding();
                });
        };

        // Attaches this client's local player to the group's already-active queue instead of
        // stranding the guest on the details page (see NoActivePlayer.js / QueueCore's own
        // startPlayback(), which is what actually creates a real player -- and, once it
        // starts, the htmlVideoPlayer SyncPlay wrapper's own 'playbackstart' listener calls
        // appRouter.showVideoOsd(), navigating to the real video route exactly like any
        // other ordinary playback start in this app). Falls back to the details page --
        // a genuine "waiting room" -- only once it's clear there's really nothing to attach
        // to (an empty queue) or attaching never actually succeeds.
        const attachToActiveGroupOrLandOnDetails = () => {
            if (isCancelled) return;

            if (syncPlay.Manager.isPlaybackActive()) {
                // Already attached to a player before we even get to waiting on anything --
                // e.g. joinGroupExplicit() took its "already in this group" early-return path
                // (reopening one's own invite link while already watching), so no new
                // 'GroupJoined'/'PlayQueue' broadcast is coming for us to wait on at all.
                hasRedirected.current = true;
                return;
            }

            syncPlay.Helper.waitForEventOnce(syncPlay.Manager, 'queue-update', QUEUE_SNAPSHOT_WAIT_MS)
                .then((args) => {
                    if (isCancelled) return;

                    if (syncPlay.Manager.isPlaylistEmpty()) {
                        // Genuinely nothing queued yet -- host hasn't started anything, so
                        // the details page is the correct "waiting room" landing spot.
                        console.debug('[SyncPlayJoin] group queue is empty, landing on details page');
                        redirectToLanding();
                        return;
                    }

                    if (syncPlay.Manager.isPlaybackActive()) {
                        // Already attached to a player (e.g. the host reopening their own
                        // invite link while already watching) -- nothing further to do.
                        hasRedirected.current = true;
                        return;
                    }

                    // `args[1]` is the raw PlayQueueUpdate the 'queue-update' event carries
                    // (see QueueCore.updatePlayQueue()). QueueCore's own updatePlayQueue()
                    // already calls startPlayback() automatically for Reason 'NewPlaylist' --
                    // avoid kicking off a second, redundant attach attempt in that case. Any
                    // other Reason assumes a player already exists to act on (e.g.
                    // setCurrentPlaylistItem()), which isn't true for a fresh joiner, so
                    // attach one explicitly ourselves.
                    const playQueueUpdate = args[1] as { Reason?: string } | undefined;
                    if (playQueueUpdate?.Reason !== 'NewPlaylist') {
                        console.debug('[SyncPlayJoin] attaching local player to active group queue');
                        syncPlay.Manager.getQueueCore().startPlayback(syncPlay.Manager.getApiClient());
                    }

                    waitForPlaybackAttach();
                })
                .catch((err) => {
                    console.error('[SyncPlayJoin] timed out waiting for group queue snapshot, landing on details page', err);
                    if (!isCancelled) redirectToLanding();
                });
        };

        // joinGroupExplicit() marks this request as an explicit group change (via
        // Manager's beginExplicitGroupChange()/endExplicitGroupChange() guard) so the
        // background restoreLastGroup() rejoin can never race it, and it only resolves once
        // the joined group's GroupId actually matches the one requested here -- so a stale
        // rejoin landing around the same time can never be mistaken for success.
        syncPlay.Manager.joinGroupExplicit(groupId)
            .then(() => {
                if (!isCancelled) attachToActiveGroupOrLandOnDetails();
            })
            .catch(err => {
                console.error('[SyncPlayJoin] failed to join SyncPlay group', err);
                if (!isCancelled) {
                    toast(globalize.translate('MessageSyncPlayJoinGroupDenied'));
                    redirectToLanding();
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [ api, groupId, itemId, navigate ]);

    return (
        <Page
            id='syncPlayJoinPage'
            title={globalize.translate('ButtonSyncPlay')}
            className='mainAnimatedPage'
            isBackButtonEnabled={false}
        >
            <div className='padded-left padded-right padded-bottom-page' style={{ textAlign: 'center' }}>
                <h2>{globalize.translate('MessageSyncPlayJoiningGroup')}</h2>
            </div>
        </Page>
    );
};

export default SyncPlayJoinPage;
