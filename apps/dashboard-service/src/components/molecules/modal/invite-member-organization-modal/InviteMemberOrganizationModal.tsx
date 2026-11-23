import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import Button from "../../../atoms/button/Button";
import Input from "../../../atoms/input/Input";
import Modal from "../../../atoms/modal/Modal";
import RoleExplanationPopover from "../../../atoms/role-explanation-popover/RoleExplanationPopover";
import Select from "../../../atoms/select/Select";
import TeamAssignmentSection from "../../team-assignment-section/TeamAssignmentSection";
import { TeamSelectionState, TeamAssignment, OrganizationInviteResponseDto } from "../../../../server/interfaces/Organization";
import {
  selectActiveProducts,
  selectCanManageBilling,
  selectGrantableProducts,
  selectMemberProductsSwitchedOff,
} from "../../../../server/store/selectors";
import { ACTIVE_EXTENSIONS } from "@/edition/active";
import type { AppsecSeatsCount as AppsecSeats } from "@/edition/extensions";
import { APPSEC, type Product } from "../../../../utils/product";
import { InvitationLinkNotice, invitationLink } from "./InvitationLinkNotice";

/*
 * Per-member products and AppSec seats, as the edition serves them
 * (`ACTIVE_EXTENSIONS.memberProducts`). Without them (the Community Edition)
 * no role holds a product of its own, no seat is full, no refusal is a
 * products refusal, and the form has no products part.
 */
const memberProducts = ACTIVE_EXTENSIONS.memberProducts;
const MemberProductsField = memberProducts?.Field ?? null;
const isAdministratorRole = (role: string | null | undefined): boolean => memberProducts?.isAdministratorRole(role) ?? false;
const appsecSeatsFull = (seats: AppsecSeats | null): boolean => memberProducts?.seatsFull(seats) ?? false;
const memberProductsRefusalOf = (error: unknown): string | null => memberProducts?.refusalOf(error) ?? null;
const memberProductsRefusalKey = (code: string, context: "invite" | "role"): string =>
  memberProducts?.refusalKey(code, context) ?? "";

interface AddMemberModalProps {
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  /**
   * Sends the invitation. A refusal of the closed list (`memberProductsRefusalOf`)
   * rejects, and the modal stays open with its sentence; anything else is the
   * page's to say, and the modal closes. It resolves to the invitation answer
   * when it has one: an answer carrying a token (no mail was sent) keeps the
   * modal open on the invitation link; any other closes it, as before.
   */
  onSendInvite: (
    email: string,
    role: string,
    teamAssignments?: TeamAssignment[],
    products?: Product[]
  ) => Promise<OrganizationInviteResponseDto | void> | OrganizationInviteResponseDto | void;
  roles?: { value: string; label: string }[];
  /** AppSec seats as billing counts them; null while unknown (not a `billing` holder, or not counted). */
  appsecSeats?: AppsecSeats | null;
}

/**
 * The boxes checked before anyone touches them: every
 * product but AppSec, and AppSec while a seat is known to be free, or when it
 * is the only product to give and its seats are not known to be full.
 */
const defaultProducts = (offered: readonly Product[], seats: AppsecSeats | null): Product[] =>
  offered.filter((product) => {
    if (product !== APPSEC) return true;
    if (appsecSeatsFull(seats)) return false;
    return seats !== null || offered.every((other) => other === APPSEC);
  });

const InviteMemberOrganizationModal: React.FC<AddMemberModalProps> = ({
  organizationId,
  organizationName,
  onClose,
  onSendInvite,
  roles = [] as { value: string; label: string }[],
  appsecSeats = null,
}) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [selectedTeams, setSelectedTeams] = useState<TeamSelectionState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // The links of the invitations no mail went out for. Held by this modal
  // only: closing it drops them, and the invitee then needs a new invitation.
  const [links, setLinks] = useState<{ email: string; token: string }[]>([]);
  // Per-member products: what the inviter may give (active, and theirs), and
  // what they chose. Until a box is touched, the defaults follow the seats,
  // which may be read after the modal opened.
  const offered = useSelector(selectGrantableProducts);
  const canAddSeats = useSelector(selectCanManageBilling);
  const [chosen, setChosen] = useState<Product[] | null>(null);

  const selectDropdownRef = useRef<HTMLDivElement>(null);

  // Simple approach: Modal will use the new logic to detect Select dropdowns automatically
  const allRefs = [selectDropdownRef];

  const lockedBoth = isAdministratorRole(role);
  // Switch off: the invitation gives both products whatever is ticked,
  // and every member already takes a seat. Read-only, and no products sent.
  const switchedOff = useSelector(selectMemberProductsSwitchedOff);
  const seatsFull = appsecSeatsFull(appsecSeats) && !switchedOff;
  // The administrator role takes every product offered; full seats leave AppSec out otherwise.
  const products: Product[] = lockedBoth || switchedOff
    ? [...offered]
    : (chosen ?? defaultProducts(offered, appsecSeats)).filter(
        (product) => offered.includes(product) && !(product === "appsec" && seatsFull)
      );
  // No box (the organisation's products are unknown): the gateway gives what the inviter may give.
  const offersProducts = offered.length > 0;
  // An inviter known to hold none of the organisation's active products has
  // nothing to give: said in a fixed sentence, and nothing is sent.
  const activeProducts = useSelector(selectActiveProducts);
  const nothingToGive = activeProducts.length > 0 && !offersProducts;
  const noProductChosen = nothingToGive || (offersProducts && products.length === 0);

  const validateSubmit = () => {
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setError(t('components.modal.inviteMember.errors.validEmail'));
      return false;
    }

    if (!role) {
      setError(t('components.modal.inviteMember.errors.selectRole'));
      return false;
    }

    // Validate that selected teams have roles assigned
    const teamsWithoutRoles = selectedTeams.filter(team => !team.selectedRole);
    if (teamsWithoutRoles.length > 0) {
      setError(t('components.modal.inviteMember.teamAssignments.errors.roleRequired'));
      return false;
    }

    setError(null);
    return true;
  };

  const handleSendInvite = async () => {
    if (noProductChosen || sending || !validateSubmit()) return;
    // Convert selectedTeams to TeamAssignment format
    const teamAssignments: TeamAssignment[] = selectedTeams
      .filter(team => team.selectedRole) // Only include teams with roles
      .map(team => ({
        teamId: team.teamId,
        role: team.selectedRole as 'team_manager' | 'analyst_developer' | 'developer' | 'read_only',
      }));

    setSending(true);
    try {
      const answer = await onSendInvite(
        email,
        role,
        teamAssignments.length > 0 ? teamAssignments : undefined,
        offersProducts && !switchedOff ? products : undefined
      );
      const token = (answer && answer.token) || "";
      if (invitationLink(token) === null) {
        onClose();
        return;
      }
      // No mail was sent: the administrator sends the link themselves.
      const invitee = answer && typeof answer.email === "string" && answer.email ? answer.email : email;
      setLinks((previous) => [...previous, { email: invitee, token }]);
      setEmail("");
      setSending(false);
    } catch (refusal: unknown) {
      const code = memberProductsRefusalOf(refusal);
      if (!code) {
        onClose();
        return;
      }
      // A fixed sentence, never the server's text; the invitation stays to be corrected.
      // An administrator always holds the Platform: full seats are a role matter, never « the other products only ».
      setError(t(memberProductsRefusalKey(code, lockedBoth ? 'role' : 'invite')));
      setSending(false);
    }
  };

  /**
   * Handles team selection changes from TeamAssignmentSection
   */
  const handleTeamSelectionChange = (teams: TeamSelectionState[]) => {
    setSelectedTeams(teams);
    // Clear error when user makes changes
    if (error) {
      setError(null);
    }
  };

  return (
    <Modal
      title={`${t('components.modal.inviteMember.title')} ${organizationName}`}
      onClose={onClose}
      size="xl"
      additionalRefs={allRefs}
      // A click beside the modal must not drop a link shown only once.
      closeOnOverlayClick={links.length === 0}
      footerButtons={
        <>
          <Button variant="white" onClick={onClose}>
            {links.length > 0 ? t('components.modal.inviteMember.done') : t('common.cancel')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleSendInvite()}
            disabled={noProductChosen}
            loading={sending}
          >
            {t('components.modal.inviteMember.sendInvite')}
          </Button>
        </>
      }
    >
      { }
      {links.map((link) => (
        <InvitationLinkNotice key={link.token} email={link.email} token={link.token} />
      ))}

      <p className="text-center text-sm text-zinc-600 dark:text-zinc-300 mb-4">
        {t('components.modal.inviteMember.inviteDescription')}
      </p>

      <div className="flex items-center space-x-4 mb-6">
        {/* Email Input */}
        <div className="relative w-2/3">
          <Input
            type="email"
            placeholder={t('components.modal.inviteMember.emailPlaceholder')}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            required
            width="w-full"
          />
        </div>

        {/* Organization Role Selector */}
        <div className="w-1/3 flex items-center gap-2">
          <div className="flex-1">
            <Select
              value={role}
              options={roles}
              placeholder={t('components.modal.inviteMember.selectRole')}
              onChange={(value) => {
                setRole(value);
                if (error) setError(null);
              }}
              width="w-full"
              dropdownRef={selectDropdownRef}
            />
          </div>
          <RoleExplanationPopover scope="organization" role={role} />
        </div>
      </div>

      {/* Products the invitation gives (per-member products) */}
      {nothingToGive && (
        <p className="mb-6 text-[13px] text-zinc-600 dark:text-zinc-300">{t('components.memberProducts.nothingToGive')}</p>
      )}

      {offersProducts && MemberProductsField && (
        <div className="mb-6">
          <MemberProductsField
            idPrefix="invite"
            offered={offered}
            selected={products}
            onChange={(next) => {
              setChosen(next as Product[]);
              if (error) setError(null);
            }}
            locked={lockedBoth}
            appsecSeats={appsecSeats}
            canAddSeats={canAddSeats}
            switchedOff={switchedOff}
          />
        </div>
      )}

      {/* Team Assignment Section */}
      <div className="mb-6">
        <TeamAssignmentSection
          organizationId={organizationId}
          selectedTeams={selectedTeams}
          onTeamSelectionChange={handleTeamSelectionChange}
        />
      </div>

      {/* Validation Error Display */}
      {error && (
        <div className="mb-4">
          <p role="alert" className="text-[13px] text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
    </Modal>
  );
};

export default InviteMemberOrganizationModal;
