import { getSyncPlayApi } from '@jellyfin/sdk/lib/utils/api/sync-play-api';
import React, { type FC, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import Page from 'components/Page';
import { pluginManager } from 'components/pluginManager';
import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { PluginType } from 'types/plugin';
import Events, { type Event } from 'utils/events';

// Safety-net delay: normally the redirect happens as soon as the `enabled`
// Manager event fires (confirming the `GroupJoined` websocket round-trip).
// This just covers the case where that event was missed or already fired
// before this component mounted.
const REDIRECT_FALLBACK_DELAY = 1500;

interface SyncPlayInstance {
    Manager: object
}

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
        const redirectToLanding = () => {
            if (hasRedirected.current) return;
            hasRedirected.current = true;
            navigate(itemId ? `/details?id=${itemId}` : '/home');
        };

        if (!groupId || !api) {
            console.error('[SyncPlayJoin] missing groupId or api instance, redirecting');
            redirectToLanding();
            return;
        }

        const syncPlay: SyncPlayInstance | undefined = pluginManager.firstOfType(PluginType.SyncPlay)?.instance;
        let fallbackTimeout: ReturnType<typeof setTimeout> | undefined;

        const onEnabled = (_e: Event, enabled: boolean) => {
            if (enabled) redirectToLanding();
        };

        if (syncPlay) {
            Events.on(syncPlay.Manager, 'enabled', onEnabled);
        }

        getSyncPlayApi(api)
            .syncPlayJoinGroup({
                joinGroupRequestDto: {
                    GroupId: groupId
                }
            })
            .then(() => {
                // The server confirms the join asynchronously via a `GroupJoined`
                // websocket event (handled by `onEnabled` above); this timeout is
                // just a fallback in case that event is missed.
                fallbackTimeout = setTimeout(redirectToLanding, REDIRECT_FALLBACK_DELAY);
            })
            .catch(err => {
                console.error('[SyncPlayJoin] failed to join SyncPlay group', err);
                toast(globalize.translate('MessageSyncPlayJoinGroupDenied'));
                redirectToLanding();
            });

        return () => {
            if (syncPlay) {
                Events.off(syncPlay.Manager, 'enabled', onEnabled);
            }
            if (fallbackTimeout) clearTimeout(fallbackTimeout);
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
