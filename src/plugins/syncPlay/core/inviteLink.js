/**
 * Module that builds shareable SyncPlay "magic link" invite URLs.
 * @module components/syncPlay/core/inviteLink
 */

import { playbackManager } from '../../../components/playback/playbackmanager';
import { copy } from '../../../scripts/clipboard';
import { announceWatchParty } from './discordNotify';

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
        // createGroupExplicit() marks this request as an explicit group change (via
        // Manager's beginExplicitGroupChange()/endExplicitGroupChange() guard) so the
        // background restoreLastGroup() rejoin can never be mistaken for -- or race -- the
        // `enabled` event confirming this newly-created group.
        await syncPlayManager.createGroupExplicit(groupName);

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

    // The app's router is hash-based (see `createHashRouter` in RootAppRouter.tsx): every
    // client route -- this one included -- is served from a SINGLE static index.html, and
    // everything after `#` is handled entirely by React Router; browsers never send the
    // fragment to the server. A plain path like `${origin}/syncplay/join` has no `#`, so a
    // fresh page load (as opposed to in-app client-side navigation) asks the server for that
    // exact literal path, which it does not know how to serve, and it 404s before React
    // Router ever runs.
    //
    // To build a link that survives a fresh load, reuse the exact origin+path(+search) of the
    // document that is *currently* loaded -- guaranteed servable, since it's what's already in
    // the address bar -- and only swap in a new hash, using the `#/path` shape that the rest of
    // this codebase already uses for in-app links (see AppRouter#getRouteUrl()).
    const currentUrl = window.location.href.split('#')[0];
    return `${currentUrl}#/syncplay/join?${params.toString()}`;
}

/**
 * Creates a new SyncPlay group and puts its invite link on the clipboard in one step.
 *
 * This is the "New group" flow: a fresh group is only useful once its link is in a
 * friend's hands, so the link lands on the clipboard immediately instead of requiring a
 * second trip through the menu's "Copy invite link" entry. Delegates to
 * getSyncPlayInviteLink(), which (given no group is joined yet) creates the group and
 * queues whatever the host currently has playing WITHOUT unpausing.
 *
 * Also announces the new party to the configured Discord channel (see
 * discordNotify.js) -- fire-and-forget, so the clipboard is never held up
 * and a Discord hiccup can't break group creation.
 * @param {Manager} syncPlayManager The SyncPlay manager.
 * @param {string} groupName The name for the new group.
 * @returns {Promise<void>} Resolves once the group exists and the link is on the clipboard.
 */
export async function createGroupWithInviteLinkOnClipboard(syncPlayManager, groupName) {
    const itemId = getCurrentItemId(syncPlayManager);
    const link = await getSyncPlayInviteLink(syncPlayManager, groupName);
    await copy(link);
    announceWatchParty(syncPlayManager, itemId, link);
}
