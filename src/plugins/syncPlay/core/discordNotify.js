/**
 * Module that announces new SyncPlay watch parties to a Discord channel.
 * @module components/syncPlay/core/discordNotify
 */

import { getSyncPlayDiscordWebhookUrl } from '../../../scripts/settings/webSettings';

/**
 * Announces a freshly created watch party to the configured Discord webhook
 * (`syncPlayDiscordWebhookUrl` in config.json; the feature is disabled when
 * the key is empty or missing).
 *
 * Fire-and-forget: the announcement is best-effort decoration on top of group
 * creation, so every failure (no webhook configured, network error, Discord
 * rejecting the payload) is logged and swallowed rather than surfaced.
 * @param {Manager} syncPlayManager The SyncPlay manager.
 * @param {string|undefined} itemId The id of the item queued into the group, if any.
 * @param {string} link The invite link for the group.
 * @returns {Promise<void>} Resolves once the announcement has been attempted.
 */
export async function announceWatchParty(syncPlayManager, itemId, link) {
    try {
        const webhookUrl = await getSyncPlayDiscordWebhookUrl();
        if (!webhookUrl) {
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

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: `🎬 **${host}** started a watch party: **${title}**\nJoin in: ${link}`
            })
        });

        if (!response.ok) {
            console.warn(`SyncPlay Discord announce failed: HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn('SyncPlay Discord announce failed:', error);
    }
}
