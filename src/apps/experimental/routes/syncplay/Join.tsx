import React, { type FC, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import Page from 'components/Page';
import { pluginManager } from 'components/pluginManager';
import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { PluginType } from 'types/plugin';

interface SyncPlayManagerLike {
    joinGroupExplicit: (groupId: string) => Promise<void>
}

interface SyncPlayInstance {
    Manager: SyncPlayManagerLike
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

        // joinGroupExplicit() marks this request as an explicit group change (via
        // Manager's beginExplicitGroupChange()/endExplicitGroupChange() guard) so the
        // background restoreLastGroup() rejoin can never race it, and it only resolves once
        // the joined group's GroupId actually matches the one requested here -- so a stale
        // rejoin landing around the same time can never be mistaken for success.
        syncPlay.Manager.joinGroupExplicit(groupId)
            .then(() => {
                if (!isCancelled) redirectToLanding();
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
