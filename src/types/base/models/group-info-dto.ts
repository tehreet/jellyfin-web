import type { GroupInfoDto as GeneratedGroupInfoDto } from '@jellyfin/sdk/lib/generated-client/models/group-info-dto';

/**
 * Extends the generated `GroupInfoDto` with `HostUsername`, a field the server has added
 * (SyncPlay group-info DTO) that the generated OpenAPI client does not know about yet.
 *
 * `HostUsername` is the username of the session that created the group. It is set once at
 * group creation and never reassigned afterward, regardless of participant churn -- unlike
 * `Participants[0]`, which is unreliable since that array's order/membership can change as
 * people join and leave.
 *
 * Once the server's OpenAPI spec is regenerated with this field, this augmentation can be
 * dropped and call sites can go back to importing `GroupInfoDto` straight from
 * `@jellyfin/sdk`.
 */
export interface GroupInfoDto extends GeneratedGroupInfoDto {
    'HostUsername'?: string | null;
}
