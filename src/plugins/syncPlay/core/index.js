import * as Helper from './Helper';
import * as Settings from './Settings';
import ManagerClass from './Manager';
import PlayerFactoryClass from './players/PlayerFactory';
import GenericPlayer from './players/GenericPlayer';

const PlayerFactory = new PlayerFactoryClass();
const Manager = new ManagerClass(PlayerFactory);

export default {
    Helper,
    // Exposed so persisted group state (e.g. the last joined group, used to silently
    // rejoin after a reload) can be inspected/cleared from outside the Manager.
    Settings,
    Manager,
    PlayerFactory,
    Players: {
        GenericPlayer
    }
};
