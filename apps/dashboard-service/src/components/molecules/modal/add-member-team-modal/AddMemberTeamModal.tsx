import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { User } from "../../../../server/interfaces/User";
import Button from "../../../atoms/button/Button";
import { Check } from "@/components/atoms/icon/icons";
import Modal from "../../../atoms/modal/Modal";
import RoleExplanationPopover from "../../../atoms/role-explanation-popover/RoleExplanationPopover";
import SearchBox from "../../../atoms/search-box/SearchBox";
import Select from "../../../atoms/select/Select";
import { useSelector } from "react-redux";
import { RootState } from "@/server/store";

interface AddMemberTeamModalProps {
  teamName: string;
  onClose: () => void;
  onAddMember: (userId: string, role: string) => void;
  usersOrganization: User[];
  roles?: { value: string; label: string }[];
  onOrganizationUsersSearchChange: (query: string) => void;
}

const AddMemberTeamModal: React.FC<AddMemberTeamModalProps> = ({
  teamName,
  onClose,
  onAddMember,
  usersOrganization = [] as User[],
  roles = [] as { value: string; label: string }[],
  onOrganizationUsersSearchChange,
}) => {
  const { t } = useTranslation();
  const currentUser = useSelector((state: RootState) => state.user);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredUsers = usersOrganization.filter(
    (user) => user.id !== currentUser.id
  );

  const validateSelection = () => {
    if (!selectedUser) {
      setError(t('components.modal.addMember.errors.selectUser'));
      return false;
    }
    if (!role) {
      setError(t('components.modal.addMember.errors.selectRole'));
      return false;
    }
    setError(null);
    return true;
  };

  const handleAddMember = () => {
    if (validateSelection()) {
      onAddMember(selectedUser, role);
      onClose();
    }
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    onOrganizationUsersSearchChange(query);
  };

  const selectedUserRecord = filteredUsers.find((user) => user.id === selectedUser);

  return (
    <Modal
      title={`${t('components.modal.addMember.title')} ${teamName}`}
      onClose={onClose}
      /* Was `xl`: two fields and an empty list in a 1000px-wide sheet, which
         is where the expanse of nothing came from. */
      size="md"
      additionalRefs={[dropdownRef]}
      footerButtons={
        <>
          <Button variant="white" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={handleAddMember} disabled={!selectedUser || !role}>
            {t('components.modal.addMember.addMember')}
          </Button>
        </>
      }
    >
      {/* Two numbered steps. The dialog used to show a search box and a role
          picker side by side with nothing between them and no list until you
          guessed you had to type — so on open it said nothing about what to do
          or in what order. */}
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t('components.modal.addMember.step1')}
          </h3>
          <SearchBox
            onSearch={handleSearchChange}
            placeholder={t('components.modal.addMember.searchPlaceholder')}
          />

          {searchQuery === '' ? (
            <p className="mt-3 text-[13px] text-zinc-500 dark:text-zinc-400">
              {t('components.modal.addMember.emptyPrompt')}
            </p>
          ) : filteredUsers.length === 0 ? (
            <p className="mt-3 text-[13px] text-zinc-500 dark:text-zinc-400">
              {t('components.modal.addMember.noUsers')}
            </p>
          ) : (
            <div className="custom-scrollbar mt-3 max-h-64 divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200 dark:divide-as-line dark:border-as-line">
              {filteredUsers.map((user) => {
                const isSelected = selectedUser === user.id;
                return (
                  <Button
                    key={user.id}
                    variant="ghost"
                    fullWidth
                    aria-pressed={isSelected}
                    onClick={() => setSelectedUser(user.id)}
                    className={`!justify-start !rounded-none h-auto gap-3 px-3 py-2.5 text-left ${
                      isSelected ? 'bg-secondary/[0.04] dark:bg-secondary/[0.08]' : ''
                    }`}
                  >
                    <img
                      src={user.picture}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full ring-1 ring-zinc-200 dark:ring-white/[0.08]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {user.firstName} {user.lastName}
                      </span>
                      <span className="block truncate text-[13px] text-zinc-500 dark:text-zinc-400">
                        {user.email}
                      </span>
                    </span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-secondary dark:text-secondary-light" />}
                  </Button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t('components.modal.addMember.step2')}
          </h3>

          {selectedUserRecord && (
            <p className="mb-2 text-[13px] text-zinc-600 dark:text-zinc-300">
              {t('components.modal.addMember.selectedName', {
                name: `${selectedUserRecord.firstName ?? ''} ${selectedUserRecord.lastName ?? ''}`.trim(),
              })}
            </p>
          )}

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Select
                value={role}
                options={roles}
                placeholder={t('components.modal.addMember.selectRole')}
                onChange={(value) => setRole(value)}
                width="w-full"
                dropdownRef={dropdownRef}
              />
            </div>
            <RoleExplanationPopover scope="team" role={role} />
          </div>

          {!selectedUser && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t('components.modal.addMember.roleLocked')}
            </p>
          )}
        </section>

        {error && <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
};

export default AddMemberTeamModal;