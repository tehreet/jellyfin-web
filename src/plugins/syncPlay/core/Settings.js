/**
 * Module that manages SyncPlay settings.
 * @module components/syncPlay/core/Settings
 */
import appSettings from '../../../scripts/settings/appSettings';

/**
 * Prefix used when saving SyncPlay settings.
 */
const PREFIX = 'syncPlay';

/**
 * Gets the value of a setting.
 * @param {string} name The name of the setting.
 * @returns {string} The value.
 */
export function getSetting(name) {
    return appSettings.get(name, PREFIX);
}

/**
 * Sets the value of a setting. Triggers an update if the new value differs from the old one.
 * @param {string} name The name of the setting.
 * @param {Object} value The value of the setting.
 */
export function setSetting(name, value) {
    return appSettings.set(name, value, PREFIX);
}

/**
 * Gets the persisted reference to the last SyncPlay group the user joined, so it can be
 * restored after something drops the WebSocket connection without an explicit "leave"
 * (e.g. a page reload, or a mobile browser/app backgrounding the tab).
 * @returns {{serverId: string, groupId: string}|null} The persisted group reference, or `null` if none is stored.
 */
export function getLastGroup() {
    const serverId = getSetting('lastGroupServerId');
    const groupId = getSetting('lastGroupId');

    if (!serverId || !groupId) {
        return null;
    }

    return { serverId, groupId };
}

/**
 * Persists the currently joined SyncPlay group, so it can be restored later.
 * @param {string} serverId The id of the server the group belongs to.
 * @param {string} groupId The id of the joined group.
 */
export function setLastGroup(serverId, groupId) {
    setSetting('lastGroupServerId', serverId || '');
    setSetting('lastGroupId', groupId || '');
}

/**
 * Clears the persisted SyncPlay group reference (e.g. after the user explicitly leaves a group).
 */
export function clearLastGroup() {
    setLastGroup('', '');
}
