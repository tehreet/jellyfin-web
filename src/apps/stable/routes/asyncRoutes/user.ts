import { AsyncRoute } from '../../../../components/router/AsyncRoute';
import { AppType } from '../../../../constants/appType';

export const ASYNC_USER_ROUTES: AsyncRoute[] = [
    { path: 'mypreferencesmenu', page: 'user/settings' },
    { path: 'quickconnect', page: 'quickConnect' },
    { path: 'search', page: 'search' },
    // Registered here too (not just in the experimental app's routes) because the SyncPlay
    // invite link is shared outside the app and must resolve for any recipient regardless of
    // which layout ('stable' vs 'experimental') their own browser happens to have saved --
    // most recipients, especially first-time/incognito visitors, default to this stable app.
    { path: 'syncplay/join', page: 'syncplay/Join', type: AppType.Experimental },
    { path: 'userprofile', page: 'user/userprofile' }
];
