import { AsyncRoute } from '../../../../components/router/AsyncRoute';
import { AppType } from '../../../../constants/appType';

export const ASYNC_USER_ROUTES: AsyncRoute[] = [
    { path: 'mypreferencesmenu', page: 'user/settings' },
    { path: 'quickconnect', page: 'quickConnect' },
    { path: 'search', page: 'search' },
    // The SyncPlay invite link is shared outside the app, so it must resolve for recipients on
    // either layout; first-time visitors may land on this one.
    { path: 'syncplay/join', page: 'syncplay/Join', type: AppType.Modern },
    { path: 'userprofile', page: 'user/userprofile' }
];
