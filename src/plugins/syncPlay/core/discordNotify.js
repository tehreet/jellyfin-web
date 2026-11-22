/**
 * Module that announces new SyncPlay watch parties to a Discord channel.
 * @module components/syncPlay/core/discordNotify
 */

import { getSyncPlayAnnounceUrl } from '../../../scripts/settings/webSettings';

/**
 * Announces a freshly created watch party.
 *
 * The announcement is POSTed as `{ host, title, link }` to the announce
 * endpoint from config.json (`syncPlayAnnounceUrl`; the feature is disabled
 * when the key is empty or missing). The endpoint — a Cloudflare Worker
 * routed on this same hostname — owns the Discord webhook and the message
 * format. Deliberately NOT a direct client->discord.com call: content
 * blockers commonly kill those, while a same-origin POST goes through.
 *
 * Fire-and-forget: the announcement is best-effort decoration on top of group
 * creation, so every failure (endpoint not configured, network error, the
 * relay rejecting the payload) is logged and swallowed rather than surfaced.
 * @param {Manager} syncPlayManager The SyncPlay manager.
 * @param {string|undefined} itemId The id of the item queued into the group, if any.
 * @param {string} link The invite link for the group.
 * @returns {Promise<void>} Resolves once the announcement has been attempted.
 */
export async function announceWatchParty(syncPlayManager, itemId, link) {
    try {
        const announceUrl = await getSyncPlayAnnounceUrl();
        if (!announceUrl) {
            return;
        }

        const apiClient = syncPlayManager.getApiClient();
        const [user, item] = await Promise.all([
            apiClient.getCurrentUser(),
            itemId ? apiClient.getItem(apiClient.getCurrentUserId(), itemId) : Promise.resolve(null)
        ]);

        const host = user?.Name || 'Someone';
        let title = 'something';
        if (item?.Name) {
            title = item.ProductionYear ? `${item.Name} (${item.ProductionYear})` : item.Name;
        }

        const response = await fetch(announceUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, title, link })
        });

        if (!response.ok) {
            console.warn(`SyncPlay announce failed: HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn('SyncPlay announce failed:', error);
    }
}
