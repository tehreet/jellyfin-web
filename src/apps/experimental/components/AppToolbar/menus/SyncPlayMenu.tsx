import { SyncPlayUserAccessType } from '@jellyfin/sdk/lib/generated-client/models/sync-play-user-access-type';
import { getSyncPlayApi } from '@jellyfin/sdk/lib/utils/api/sync-play-api';
import ContentCopy from '@mui/icons-material/ContentCopy';
import GroupAdd from '@mui/icons-material/GroupAdd';
import Person from '@mui/icons-material/Person';
import PersonAdd from '@mui/icons-material/PersonAdd';
import PersonOff from '@mui/icons-material/PersonOff';
import PersonRemove from '@mui/icons-material/PersonRemove';
import PlayCircle from '@mui/icons-material/PlayCircle';
import StopCircle from '@mui/icons-material/StopCircle';
import Tune from '@mui/icons-material/Tune';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu, { MenuProps } from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { FC, useCallback, useEffect, useRef, useState } from 'react';

import { pluginManager } from 'components/pluginManager';
import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import { useSyncPlayGroups } from 'hooks/useSyncPlayGroups';
import globalize from 'lib/globalize';
import { getSyncPlayInviteLink } from 'plugins/syncPlay/core/inviteLink';
import { copy } from 'scripts/clipboard';
import type { GroupInfoDto } from 'types/base/models/group-info-dto';
import { PluginType } from 'types/plugin';
import Events, { Event } from 'utils/events';

export const ID = 'app-sync-play-menu';

interface SyncPlayMenuProps extends MenuProps {
    onMenuClose: () => void
}

interface SyncPlayInstance {
    Manager: {
        getGroupInfo: () => GroupInfoDto | null | undefined
        getTimeSyncCore: () => object
        isPlaybackActive: () => boolean
        isPlaylistEmpty: () => boolean
        haltGroupPlayback: (apiClient: ApiClient) => void
        resumeGroupPlayback: (apiClient: ApiClient) => void
        getHostUsername: () => string | null
        isLocalClientBuffering: () => boolean
        isGroupBuffering: () => boolean
    }
}

/**
 * Gets the secondary line shown under a participant's name in the SyncPlay menu.
 */
function getParticipantSecondaryText(isBuffering: boolean, isHost: boolean): string | undefined {
    if (isBuffering) {
        return globalize.translate('LabelSyncPlayBuffering');
    }
    if (isHost) {
        return globalize.translate('LabelSyncPlayHost');
    }
    return undefined;
}

/**
 * Tracks buffering state for the SyncPlay menu: whether the local client is buffering
 * (accurate, reported by the local player) and whether the group as a whole is waiting
 * on someone to buffer (the server does not say who). Also surfaces a one-shot toast
 * when the group starts stalling, so users get an answer to "why are we frozen" without
 * needing to open the menu.
 */
function useSyncPlayBufferingState(syncPlay: SyncPlayInstance | undefined, enabled: boolean, username: string | null | undefined) {
    const [ selfBuffering, setSelfBuffering ] = useState(false);
    const [ groupBuffering, setGroupBuffering ] = useState(false);
    const wasBufferingRef = useRef(false);

    useEffect(() => {
        if (!syncPlay || !enabled) {
            setSelfBuffering(false);
            setGroupBuffering(false);
            return;
        }

        setSelfBuffering(syncPlay.Manager.isLocalClientBuffering());
        setGroupBuffering(syncPlay.Manager.isGroupBuffering());

        const onSelfBuffering = () => setSelfBuffering(true);
        const onSelfReady = () => setSelfBuffering(false);
        const onGroupStateUpdate = (_e: Event, state: string, reason: string) => {
            setGroupBuffering(state === 'Waiting' && reason === 'Buffer');
        };

        Events.on(syncPlay.Manager, 'buffering', onSelfBuffering);
        Events.on(syncPlay.Manager, 'ready', onSelfReady);
        Events.on(syncPlay.Manager, 'group-state-update', onGroupStateUpdate);

        return () => {
            Events.off(syncPlay.Manager, 'buffering', onSelfBuffering);
            Events.off(syncPlay.Manager, 'ready', onSelfReady);
            Events.off(syncPlay.Manager, 'group-state-update', onGroupStateUpdate);
        };
    }, [ syncPlay, enabled ]);

    useEffect(() => {
        const isBuffering = selfBuffering || groupBuffering;

        if (isBuffering && !wasBufferingRef.current) {
            toast(
                selfBuffering ?
                    globalize.translate('MessageSyncPlayGroupWait', username ?? '') :
                    globalize.translate('MessageSyncPlayGroupWaitOthers')
            );
        }

        wasBufferingRef.current = isBuffering;
    }, [ selfBuffering, groupBuffering, username ]);

    return { selfBuffering, groupBuffering };
}

/**
 * Builds the per-participant rows for the SyncPlay menu, including a per-user buffering
 * spinner (accurate only for the local participant, since the server does not report
 * per-participant buffering state) and a generic "someone is buffering" row otherwise.
 */
function buildParticipantMenuItems(
    participants: string[],
    hostUsername: string | null,
    localUsername: string | null | undefined,
    selfBuffering: boolean,
    groupBuffering: boolean
) {
    const items = participants.map(participant => {
        const isSelf = participant === localUsername;
        const isHost = participant === hostUsername;
        const isParticipantBuffering = isSelf && selfBuffering;

        return (
            <MenuItem
                key={`sync-play-participant-${participant}`}
                disabled
            >
                <ListItemIcon>
                    {isParticipantBuffering ? <CircularProgress size={20} /> : <Person />}
                </ListItemIcon>
                <ListItemText
                    primary={participant}
                    secondary={getParticipantSecondaryText(isParticipantBuffering, isHost)}
                />
            </MenuItem>
        );
    });

    if (groupBuffering && !selfBuffering) {
        items.push(
            <MenuItem
                key='sync-play-group-buffering'
                disabled
            >
                <ListItemIcon>
                    <CircularProgress size={20} />
                </ListItemIcon>
                <ListItemText primary={globalize.translate('MessageSyncPlayGroupWaitOthers')} />
            </MenuItem>
        );
    }

    items.push(<Divider key='sync-play-participants-divider' />);

    return items;
}

interface ActiveGroupMenuOptions {
    participants: string[] | undefined
    hostUsername: string | null
    localUsername: string | null | undefined
    selfBuffering: boolean
    groupBuffering: boolean
    canResumePlayback: boolean
    canHaltPlayback: boolean
    onStartGroupPlaybackClick: () => void
    onStopGroupPlaybackClick: () => void
    onGroupSettingsClick: () => void
    onCopyInviteLinkClick: () => void
    onGroupLeaveClick: () => void
}

/**
 * Builds the menu items shown while the user is part of a SyncPlay group: the
 * participant list, playback resume/halt controls, and group management actions.
 */
function buildActiveGroupMenuItems(options: ActiveGroupMenuOptions) {
    const items = [];

    if (options.participants?.length) {
        items.push(...buildParticipantMenuItems(
            options.participants,
            options.hostUsername,
            options.localUsername,
            options.selfBuffering,
            options.groupBuffering
        ));
    }

    if (options.canResumePlayback) {
        items.push(
            <MenuItem
                key='sync-play-start-playback'
                onClick={options.onStartGroupPlaybackClick}
            >
                <ListItemIcon>
                    <PlayCircle />
                </ListItemIcon>
                <ListItemText primary={globalize.translate('LabelSyncPlayResumePlayback')} />
            </MenuItem>
        );
    } else if (options.canHaltPlayback) {
        items.push(
            <MenuItem
                key='sync-play-stop-playback'
                onClick={options.onStopGroupPlaybackClick}
            >
                <ListItemIcon>
                    <StopCircle />
                </ListItemIcon>
                <ListItemText primary={globalize.translate('LabelSyncPlayHaltPlayback')} />
            </MenuItem>
        );
    }

    items.push(
        <MenuItem
            key='sync-play-settings'
            onClick={options.onGroupSettingsClick}
        >
            <ListItemIcon>
                <Tune />
            </ListItemIcon>
            <ListItemText
                primary={globalize.translate('Settings')}
            />
        </MenuItem>
    );

    items.push(
        <MenuItem
            key='sync-play-copy-invite-link'
            onClick={options.onCopyInviteLinkClick}
        >
            <ListItemIcon>
                <ContentCopy />
            </ListItemIcon>
            <ListItemText
                primary={globalize.translate('LabelSyncPlayCopyInviteLink')}
            />
        </MenuItem>
    );

    items.push(<Divider key='sync-play-controls-divider' />);

    items.push(
        <MenuItem
            key='sync-play-exit'
            onClick={options.onGroupLeaveClick}
        >
            <ListItemIcon>
                <PersonRemove />
            </ListItemIcon>
            <ListItemText
                primary={globalize.translate('LabelSyncPlayLeaveGroup')}
            />
        </MenuItem>
    );

    return items;
}

const SyncPlayMenu: FC<SyncPlayMenuProps> = ({
    anchorEl,
    open,
    onMenuClose
}) => {
    const [ syncPlay, setSyncPlay ] = useState<SyncPlayInstance>();
    const { __legacyApiClient__, api, user } = useApi();
    const [ currentGroup, setCurrentGroup ] = useState<GroupInfoDto>();
    const isSyncPlayEnabled = Boolean(currentGroup);
    const { selfBuffering, groupBuffering } = useSyncPlayBufferingState(syncPlay, isSyncPlayEnabled, user?.Name);

    useEffect(() => {
        setSyncPlay(pluginManager.firstOfType(PluginType.SyncPlay)?.instance);
    }, []);

    const { data: groups } = useSyncPlayGroups();

    const onGroupAddClick = useCallback(() => {
        if (api && user) {
            getSyncPlayApi(api)
                .syncPlayCreateGroup({
                    newGroupRequestDto: {
                        GroupName: globalize.translate('SyncPlayGroupDefaultTitle', user.Name)
                    }
                })
                .catch(err => {
                    console.error('[SyncPlayMenu] failed to create a SyncPlay group', err);
                });

            onMenuClose();
        }
    }, [ api, onMenuClose, user ]);

    const onGroupLeaveClick = useCallback(() => {
        if (api) {
            getSyncPlayApi(api)
                .syncPlayLeaveGroup()
                .catch(err => {
                    console.error('[SyncPlayMenu] failed to leave SyncPlay group', err);
                });

            onMenuClose();
        }
    }, [ api, onMenuClose ]);

    const onGroupJoinClick = useCallback((GroupId: string) => {
        if (api) {
            getSyncPlayApi(api)
                .syncPlayJoinGroup({
                    joinGroupRequestDto: {
                        GroupId
                    }
                })
                .catch(err => {
                    console.error('[SyncPlayMenu] failed to join SyncPlay group', err);
                });

            onMenuClose();
        }
    }, [ api, onMenuClose ]);

    const onGroupSettingsClick = useCallback(async () => {
        if (!syncPlay) return;

        // TODO: Rewrite settings UI
        const SyncPlaySettingsEditor = (await import('../../../../../plugins/syncPlay/ui/settings/SettingsEditor')).default;
        new SyncPlaySettingsEditor(
            __legacyApiClient__,
            syncPlay.Manager.getTimeSyncCore(),
            {
                groupInfo: currentGroup
            })
            .embed()
            .catch(err => {
                if (err) {
                    console.error('[SyncPlayMenu] Error creating SyncPlay settings editor', err);
                }
            });

        onMenuClose();
    }, [ __legacyApiClient__, currentGroup, onMenuClose, syncPlay ]);

    const onStartGroupPlaybackClick = useCallback(() => {
        if (__legacyApiClient__) {
            syncPlay?.Manager.resumeGroupPlayback(__legacyApiClient__);
            onMenuClose();
        }
    }, [ __legacyApiClient__, onMenuClose, syncPlay ]);

    const onStopGroupPlaybackClick = useCallback(() => {
        if (__legacyApiClient__) {
            syncPlay?.Manager.haltGroupPlayback(__legacyApiClient__);
            onMenuClose();
        }
    }, [ __legacyApiClient__, onMenuClose, syncPlay ]);

    const onCopyInviteLinkClick = useCallback(() => {
        if (!syncPlay || !user) return;

        getSyncPlayInviteLink(
            syncPlay.Manager,
            globalize.translate('SyncPlayGroupDefaultTitle', user.Name)
        ).then(link => (
            copy(link)
        )).then(() => {
            toast(globalize.translate('MessageSyncPlayInviteLinkCopied'));
        }).catch(err => {
            console.error('[SyncPlayMenu] failed to copy SyncPlay invite link', err);
        });

        onMenuClose();
    }, [ onMenuClose, syncPlay, user ]);

    const updateSyncPlayGroup = useCallback((_e: Event, enabled: boolean) => {
        setCurrentGroup(enabled ? (syncPlay?.Manager.getGroupInfo() ?? undefined) : undefined);
    }, [ syncPlay ]);

    useEffect(() => {
        if (!syncPlay) return;

        Events.on(syncPlay.Manager, 'enabled', updateSyncPlayGroup);

        return () => {
            Events.off(syncPlay.Manager, 'enabled', updateSyncPlayGroup);
        };
    }, [ updateSyncPlayGroup, syncPlay ]);

    const menuItems = [];
    if (isSyncPlayEnabled) {
        menuItems.push(...buildActiveGroupMenuItems({
            participants: currentGroup?.Participants,
            hostUsername: syncPlay?.Manager.getHostUsername() ?? null,
            localUsername: user?.Name,
            selfBuffering,
            groupBuffering,
            canResumePlayback: !syncPlay?.Manager.isPlaylistEmpty() && !syncPlay?.Manager.isPlaybackActive(),
            canHaltPlayback: Boolean(syncPlay?.Manager.isPlaybackActive()),
            onStartGroupPlaybackClick,
            onStopGroupPlaybackClick,
            onGroupSettingsClick,
            onCopyInviteLinkClick,
            onGroupLeaveClick
        }));
    } else if (!groups?.length && user?.Policy?.SyncPlayAccess !== SyncPlayUserAccessType.CreateAndJoinGroups) {
        menuItems.push(
            <MenuItem key='sync-play-unavailable' disabled>
                <ListItemIcon>
                    <PersonOff />
                </ListItemIcon>
                <ListItemText primary={globalize.translate('LabelSyncPlayNoGroups')} />
            </MenuItem>
        );
    } else {
        if (groups && groups.length > 0) {
            groups.forEach(group => {
                menuItems.push(
                    <MenuItem
                        key={group.GroupId}
                        // Since we are looping over groups there is no good way to avoid creating a new function here
                        // eslint-disable-next-line react/jsx-no-bind
                        onClick={() => group.GroupId && onGroupJoinClick(group.GroupId)}
                    >
                        <ListItemIcon>
                            <PersonAdd />
                        </ListItemIcon>
                        <ListItemText
                            primary={group.GroupName}
                            secondary={group.Participants?.join(', ')}
                        />
                    </MenuItem>
                );
            });

            menuItems.push(
                <Divider key='sync-play-groups-divider' />
            );
        }

        if (user?.Policy?.SyncPlayAccess === SyncPlayUserAccessType.CreateAndJoinGroups) {
            menuItems.push(
                <MenuItem
                    key='sync-play-new-group'
                    onClick={onGroupAddClick}
                >
                    <ListItemIcon>
                        <GroupAdd />
                    </ListItemIcon>
                    <ListItemText primary={globalize.translate('LabelSyncPlayNewGroupDescription')} />
                </MenuItem>
            );
        }
    }

    const MenuListProps = isSyncPlayEnabled ? {
        'aria-labelledby': 'sync-play-active-subheader',
        subheader: (
            <ListSubheader component='div' id='sync-play-active-subheader'>
                {currentGroup?.GroupName}
            </ListSubheader>
        )
    } : undefined;

    return (
        <Menu
            anchorEl={anchorEl}
            anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right'
            }}
            transformOrigin={{
                vertical: 'top',
                horizontal: 'right'
            }}
            id={ID}
            keepMounted
            open={open}
            onClose={onMenuClose}
            slotProps={{
                list: MenuListProps
            }}
        >
            {menuItems}
        </Menu>
    );
};

export default SyncPlayMenu;
