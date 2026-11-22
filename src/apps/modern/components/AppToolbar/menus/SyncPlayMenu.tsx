import { SyncPlayUserAccessType } from '@jellyfin/sdk/lib/generated-client/models/sync-play-user-access-type';
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
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu, { MenuProps } from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import React, { FC, useCallback, useEffect, useRef, useState } from 'react';

import SyncPlayGroupListItem from 'apps/modern/features/syncPlay/components/SyncPlayGroupListItem';
import { useJoinSyncPlayGroup } from 'apps/modern/features/syncPlay/hooks/api/useJoinSyncPlayGroup';
import { useLeaveSyncPlayGroup } from 'apps/modern/features/syncPlay/hooks/api/useLeaveSyncPlayGroup';
import { QUERY_KEY as SYNC_PLAY_GROUPS_QUERY_KEY, useSyncPlayGroups } from 'apps/modern/features/syncPlay/hooks/api/useSyncPlayGroups';
import { type SyncPlayInstance, useSyncPlay } from 'apps/modern/features/syncPlay/hooks/useSyncPlay';
import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { createGroupWithInviteLinkOnClipboard, getSyncPlayInviteLink } from 'plugins/syncPlay/core/inviteLink';
import { copy } from 'scripts/clipboard';
import Events, { type Event } from 'utils/events';
import { queryClient } from 'utils/query/queryClient';

export const ID = 'app-sync-play-menu';

/**
 * Tracks whether the local client is buffering (reported by the local player) and whether
 * the group as a whole is waiting on someone. Toasts once when the group starts stalling.
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

interface SyncPlayMenuProps extends MenuProps {
    onMenuClose: () => void
}

/** Participant rows for the active-group menu: host badge and the local buffering spinner. */
function buildParticipantItems(
    participants: string[] | null | undefined,
    hostUsername: string | null,
    localUsername: string | null | undefined,
    selfBuffering: boolean,
    groupBuffering: boolean
) {
    const items: React.JSX.Element[] = [];
    if (!participants?.length) return items;

    participants.forEach(participant => {
        const isBuffering = participant === localUsername && selfBuffering;
        let secondary: string | undefined;
        if (isBuffering) {
            secondary = globalize.translate('LabelSyncPlayBuffering');
        } else if (participant === hostUsername) {
            secondary = globalize.translate('LabelSyncPlayHost');
        }
        items.push(
            <MenuItem key={`sync-play-participant-${participant}`} disabled>
                <ListItemIcon>
                    {isBuffering ? <CircularProgress size={20} /> : <Person />}
                </ListItemIcon>
                <ListItemText primary={participant} secondary={secondary} />
            </MenuItem>
        );
    });

    if (groupBuffering && !selfBuffering) {
        items.push(
            <MenuItem key='sync-play-group-buffering' disabled>
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

const SyncPlayMenu: FC<SyncPlayMenuProps> = ({
    anchorEl,
    open,
    onMenuClose
}) => {
    const { __legacyApiClient__, user } = useApi();
    const {
        isActive: isSyncPlayEnabled,
        currentGroup,
        syncPlay
    } = useSyncPlay();
    const { data: groups } = useSyncPlayGroups();

    const { selfBuffering, groupBuffering } = useSyncPlayBufferingState(syncPlay, isSyncPlayEnabled, user?.Name);
    const joinSyncPlayGroup = useJoinSyncPlayGroup();
    const leaveSyncPlayGroup = useLeaveSyncPlayGroup();

    const onGroupAddClick = useCallback(() => {
        if (!syncPlay || !user) return;

        // Creating a group also drops its invite link straight onto the clipboard (and
        // announces the party): a fresh group is only useful once someone has the link.
        createGroupWithInviteLinkOnClipboard(
            syncPlay.Manager,
            globalize.translate('SyncPlayGroupDefaultTitle', user.Name ?? '')
        ).then(() => {
            toast(globalize.translate('MessageSyncPlayInviteLinkCopied'));
        }).catch(err => {
            console.error('[SyncPlayMenu] failed to create a SyncPlay group', err);
        }).finally(() => {
            void queryClient.invalidateQueries({ queryKey: SYNC_PLAY_GROUPS_QUERY_KEY });
        });

        onMenuClose();
    }, [ onMenuClose, syncPlay, user ]);

    const onCopyInviteLinkClick = useCallback(() => {
        if (!syncPlay || !user) return;

        getSyncPlayInviteLink(
            syncPlay.Manager,
            globalize.translate('SyncPlayGroupDefaultTitle', user.Name ?? '')
        ).then(link => (
            copy(link)
        )).then(() => {
            toast(globalize.translate('MessageSyncPlayInviteLinkCopied'));
        }).catch(err => {
            console.error('[SyncPlayMenu] failed to copy SyncPlay invite link', err);
        });

        onMenuClose();
    }, [ onMenuClose, syncPlay, user ]);

    const onGroupLeaveClick = useCallback(() => {
        leaveSyncPlayGroup.mutate(undefined, {
            onSettled: onMenuClose
        });
    }, [ leaveSyncPlayGroup, onMenuClose ]);

    const onGroupJoinClick = useCallback((GroupId: string) => {
        joinSyncPlayGroup.mutate({
            joinGroupRequestDto: {
                GroupId
            }
        }, {
            onSettled: onMenuClose
        });
    }, [ joinSyncPlayGroup, onMenuClose ]);

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

    const menuItems = [];
    if (isSyncPlayEnabled) {
        menuItems.push(...buildParticipantItems(
            currentGroup?.Participants,
            syncPlay?.Manager.getHostUsername() ?? null,
            user?.Name,
            selfBuffering,
            groupBuffering
        ));

        if (!syncPlay?.Manager.isPlaylistEmpty() && !syncPlay?.Manager.isPlaybackActive()) {
            menuItems.push(
                <MenuItem
                    key='sync-play-start-playback'
                    onClick={onStartGroupPlaybackClick}
                >
                    <ListItemIcon>
                        <PlayCircle />
                    </ListItemIcon>
                    <ListItemText primary={globalize.translate('LabelSyncPlayResumePlayback')} />
                </MenuItem>
            );
        } else if (syncPlay?.Manager.isPlaybackActive()) {
            menuItems.push(
                <MenuItem
                    key='sync-play-stop-playback'
                    onClick={onStopGroupPlaybackClick}
                >
                    <ListItemIcon>
                        <StopCircle />
                    </ListItemIcon>
                    <ListItemText primary={globalize.translate('LabelSyncPlayHaltPlayback')} />
                </MenuItem>
            );
        }

        menuItems.push(
            <MenuItem
                key='sync-play-settings'
                onClick={onGroupSettingsClick}
            >
                <ListItemIcon>
                    <Tune />
                </ListItemIcon>
                <ListItemText
                    primary={globalize.translate('Settings')}
                />
            </MenuItem>
        );

        menuItems.push(
            <MenuItem
                key='sync-play-copy-invite-link'
                onClick={onCopyInviteLinkClick}
            >
                <ListItemIcon>
                    <ContentCopy />
                </ListItemIcon>
                <ListItemText
                    primary={globalize.translate('LabelSyncPlayCopyInviteLink')}
                />
            </MenuItem>
        );
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
                    <ListItem key={group.GroupId}>
                        <SyncPlayGroupListItem
                            group={group}
                            button={{
                                onClick: () => group.GroupId && onGroupJoinClick(group.GroupId),
                                tooltip: globalize.translate('LabelSyncPlayJoinGroup'),
                                Icon: PersonAdd
                            }}
                        />
                    </ListItem>
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
            <>
                <ListSubheader
                    id='sync-play-active-subheader'
                    component='div'
                    sx={{ marginY: 1.75 }}
                >
                    <SyncPlayGroupListItem
                        group={currentGroup!}
                        button={{
                            onClick: onGroupLeaveClick,
                            tooltip: globalize.translate('LabelSyncPlayLeaveGroup'),
                            Icon: PersonRemove
                        }}
                    />
                </ListSubheader>
                <Divider />
            </>
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
