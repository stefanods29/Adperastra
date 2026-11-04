import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import { formatDate, formatSize } from "../services/format";
import type { DuplicateGroup, DuplicateMember } from "../services/storage";
import { identityKeyText } from "../services/storage";

/** Explicit keeper review (Step 11c T5). Every member starts checked as a
 * keeper. The user may uncheck copies for recycling, but at least one
 * physical member per verified group must remain. Hard-link aliases are one
 * member with several paths, never several reclaimable copies. */

export function memberKey(member: DuplicateMember): string {
  return identityKeyText(member.key);
}

/** Default review state: keep all physical members. */
export function defaultKeepers(group: DuplicateGroup): Set<string> {
  return new Set(group.members.map(memberKey));
}

/** Suggest one keeper by explicit root order, then newer modified time,
 * then the path ordinal. It only checks boxes; it never runs an action. */
export function suggestKeeper(
  group: DuplicateGroup,
  rootOrder: readonly string[] = [],
): string | null {
  const rank = (member: DuplicateMember): number => {
    const path = member.paths[0]?.toLowerCase() ?? "";
    const index = rootOrder.findIndex((root) =>
      path.startsWith(root.toLowerCase().replace(/\\+$/, "\\")),
    );
    return index >= 0 ? index : rootOrder.length + 1;
  };
  const sorted = [...group.members].sort((left, right) => {
    const location = rank(left) - rank(right);
    if (location !== 0) return location;
    const modified = right.modified_unix - left.modified_unix;
    if (modified !== 0) return modified;
    return (left.paths[0] ?? "").toLowerCase() < (right.paths[0] ?? "").toLowerCase()
      ? -1
      : 1;
  });
  return sorted[0] ? memberKey(sorted[0]) : null;
}

/** At least one physical member must stay; a partial page cannot be reviewed. */
export function keeperSelectionIsValid(
  group: DuplicateGroup,
  keepers: ReadonlySet<string>,
): boolean {
  if (!group.members_page_complete) return false;
  if (keepers.size === 0) return false;
  return group.members.some((member) => keepers.has(memberKey(member)));
}

export function selectedCopies(
  group: DuplicateGroup,
  keepers: ReadonlySet<string>,
): DuplicateMember[] {
  return group.members.filter((member) => !keepers.has(memberKey(member)));
}

export function cleanupCanRun(
  group: DuplicateGroup,
  keepers: ReadonlySet<string>,
  capability: boolean,
): boolean {
  return (
    capability &&
    group.verified &&
    group.members_page_complete &&
    keeperSelectionIsValid(group, keepers) &&
    selectedCopies(group, keepers).length > 0
  );
}

export interface DuplicateReviewDialogProps {
  group: DuplicateGroup;
  keepers: ReadonlySet<string>;
  capability: boolean;
  busy?: boolean;
  error?: string | null;
  onToggleKeep: (member: DuplicateMember) => void;
  onSuggest: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export default function DuplicateReviewDialog(props: DuplicateReviewDialogProps) {
  const { t, i18n } = useTranslation();
  const selected = selectedCopies(props.group, props.keepers);
  const valid = keeperSelectionIsValid(props.group, props.keepers);
  const canRun = cleanupCanRun(props.group, props.keepers, props.capability);
  const reclaim =
    typeof props.group.reclaimable_bytes === "number"
      ? formatSize(props.group.reclaimable_bytes, i18n.language)
      : t("storage.unknownValue");

  return (
    <Dialog
      title={t("duplicates.review")}
      onClose={props.onClose}
      className="adp-duplicates-dialog"
    >
      <div className="adp-duplicate-review">
        <div className="adp-duplicate-group-header">
          <span>
            {t("duplicates.review")} - {props.group.member_count}
          </span>
          <span>
            {t("duplicates.reclaim", { size: reclaim })}
          </span>
        </div>
        <ul className="adp-duplicate-members" aria-label={t("duplicates.review")}>
          {props.group.members.map((member) => {
            const key = memberKey(member);
            const keep = props.keepers.has(key);
            return (
              <li key={key} className="adp-duplicate-member">
                <label className="adp-duplicate-keep">
                  <input
                    type="checkbox"
                    checked={keep}
                    onChange={() => props.onToggleKeep(member)}
                    aria-label={t("duplicates.keep")}
                  />
                  <span>{t("duplicates.keep")}</span>
                </label>
                <span className="adp-duplicate-path" title={member.paths[0]}>
                  {member.paths[0]}
                </span>
                <span>{formatSize(member.logical_bytes, i18n.language)}</span>
                <span>{member.modified_unix ? formatDate(member.modified_unix, i18n.language) : ""}</span>
                {member.paths.length > 1 ? (
                  <span className="adp-duplicate-hardlink">{t("duplicates.hardlink")}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!props.group.verified ? (
          <p className="adp-duplicate-warning">{t("duplicates.unverified")}</p>
        ) : !props.group.members_page_complete ? (
          <p className="adp-duplicate-warning">{t("duplicates.incompleteGroup")}</p>
        ) : null}
        {!valid ? <p className="adp-duplicate-warning">{t("duplicates.keepOne")}</p> : null}
        {!props.capability ? (
          <p className="adp-duplicate-warning">{t("duplicates.cleanupUnavailable")}</p>
        ) : null}
        {props.error ? (
          <p className="adp-duplicate-warning" role="alert">
            {props.error}
          </p>
        ) : null}
        <p className="adp-duplicate-summary">
          {t("duplicates.reclaim", { size: reclaim })}
        </p>
        <div className="adp-duplicate-actions">
          <Button variant="subtle" onClick={props.onSuggest} disabled={props.busy}>
            {t("duplicates.suggest")}
          </Button>
          <Button variant="subtle" onClick={props.onClose} disabled={props.busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!canRun || props.busy}
            onClick={props.onConfirm}
            title={!props.capability ? t("duplicates.cleanupUnavailable") : undefined}
          >
            {t("duplicates.recycle")}
            {selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

