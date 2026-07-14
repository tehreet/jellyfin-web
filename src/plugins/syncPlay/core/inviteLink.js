/**
 * Module that builds shareable SyncPlay "magic link" invite URLs.
 * @module components/syncPlay/core/inviteLink
 */

import * as Helper from './Helper';
import { appRouter } from '../../../components/router/appRouter';
import { playbackManager } from '../../../components/playback/playbackmanager';

/**
 * Gets the id of the item the host is currently watching/queued, if any.
 * @param {Manager} syncPlayManager The SyncPlay manager.
 * @returns {string|undefined} The item id, if one could be determined.
 */
function getCurrentItemId(syncPlayManager) {
    const player = playbackManager.getCurrentPlayer();
    const currentItem = player && playbackManager.currentItem(player);
    if (currentItem?.Id) {
        return currentItem.Id;
    }

    const queueCore = syncPlayManager.getQueueCore();
    const playlist = queueCore.getPlaylist();
    const currentIndex = queueCore.getCurrentPlaylistIndex();
    return playlist[currentIndex]?.ItemId;
}

/**
 * Builds a shareable SyncPlay "magic link" for the host's group.
 *
 * If the host is already in a group (the common case), the link is built
 * from that group and whatever item is currently playing/queued.
 *
 * If the host is not in a group yet, a new group is created and, if the
 * host currently has something playing, it is queued into the new group
 * WITHOUT unpausing -- the guest lands in a waiting room and the host's
 * next "Play" press (already routed through SyncPlay by NoActivePlayer)
 * starts the party for everyone.
 * @param {Manager} syncPlayManager The SyncPlay manager.
 * @param {string} groupName The name to use if a new group must be created.
 * @returns {Promise<string>} A promise that resolves with the absolute invite URL.
 */
export async function getSyncPlayInviteLink(syncPlayManager, groupName) {
    const itemId = getCurrentItemId(syncPlayManager);

    if (!syncPlayManager.isSyncPlayEnabled()) {
        const apiClient = syncPlayManager.getApiClient();

        apiClient.createSyncPlayGroup({
            GroupName: groupName
        });

        // Wait for the server to confirm the group was joined (`GroupJoined` ->
        // `enableSyncPlay()` -> `enabled` event) before we know the GroupId.
        await Helper.waitForEventOnce(syncPlayManager, 'enabled', Helper.WaitForEventDefaultTimeout);

        if (itemId) {
            // Queues the item into the fresh group without unpausing.
            await syncPlayManager.getController().play({ ids: [itemId] });
        }
    }

    const groupId = syncPlayManager.getGroupInfo()?.GroupId;
    if (!groupId) {
        throw new Error('SyncPlay group id is not available');
    }

    // eslint-disable-next-line compat/compat
    const params = new URLSearchParams({ groupId });
    if (itemId) {
        params.set('itemId', itemId);
    }

    return `${window.location.origin}${appRouter.baseUrl()}/syncplay/join?${params.toString()}`;
}
