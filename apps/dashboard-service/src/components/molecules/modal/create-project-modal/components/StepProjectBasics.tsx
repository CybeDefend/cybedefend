import React from "react";
import { useTranslation } from "react-i18next";
import Input from "../../../../atoms/input/Input";
import Select from "../../../../atoms/select/Select";
import { Input as VdInput } from "@/components/molecules/kit/ui";

interface StepProjectBasicsProps {
  projectName: string;
  onProjectNameChange: (value: string) => void;
  teams: { label: string; value: string }[];
  selectedTeamId: string;
  onTeamChange: (value: string) => void;
  errors: { projectName?: string; teamId?: string };
  teamDropdownRef: React.RefObject<HTMLDivElement | null>;
  /** Draws the name field with the zinc kit. Omitted: today's form. */
  zinc?: boolean;
}

const VD_LABEL = "mb-1.5 block text-[13px] font-medium text-zinc-900 dark:text-zinc-100";
const VD_ERROR = "mt-1.5 text-xs text-red-600 dark:text-red-400";

const StepProjectBasics: React.FC<StepProjectBasicsProps> = ({
  projectName,
  onProjectNameChange,
  teams,
  selectedTeamId,
  onTeamChange,
  errors,
  teamDropdownRef,
  zinc = false,
}) => {
  const { t } = useTranslation();
  const nameId = React.useId();
  if (zinc) {
    return (
      <div className="space-y-5">
        <div>
          <label htmlFor={nameId} className={VD_LABEL}>
            {t("components.modal.createProject.projectName")}
          </label>
          <VdInput
            id={nameId}
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            placeholder={t("components.modal.createProject.enterProjectName")}
            aria-invalid={errors.projectName ? true : undefined}
            aria-describedby={errors.projectName ? `${nameId}-error` : undefined}
          />
          {errors.projectName && (
            <p id={`${nameId}-error`} className={VD_ERROR}>
              {errors.projectName}
            </p>
          )}
        </div>
        {teams.length > 1 ? (
          <div>
            <span className={VD_LABEL}>{t("components.modal.createProject.selectTeam")}</span>
            {/* The shared select stays: its menu is registered with the dialog (`dropdownRef`). */}
            <Select
              options={teams}
              placeholder={t("components.modal.createProject.selectATeam")}
              value={selectedTeamId}
              onChange={(value) => onTeamChange(value)}
              dropdownRef={teamDropdownRef}
              width="w-full"
            />
            {errors.teamId && <p className={VD_ERROR}>{errors.teamId}</p>}
          </div>
        ) : (
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
            {t("components.modal.createProject.teamAutoSelected")}{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{teams[0]?.label}</span>
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Input
        label={t("components.modal.createProject.projectName")}
        value={projectName}
        onChange={(e) => onProjectNameChange(e.target.value)}
        placeholder={t("components.modal.createProject.enterProjectName")}
        error={errors.projectName}
      />
      {teams.length > 1 ? (
        <div>
          <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            {t("components.modal.createProject.selectTeam")}
          </label>
          <Select
            options={teams}
            placeholder={t("components.modal.createProject.selectATeam")}
            value={selectedTeamId}
            onChange={(value) => onTeamChange(value)}
            dropdownRef={teamDropdownRef}
            width="w-full"
          />
          {errors.teamId && (
            <p className="mt-1.5 text-[13px] text-red-600 dark:text-red-400">
              {errors.teamId}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("components.modal.createProject.teamAutoSelected")}{" "}
          <strong>{teams[0]?.label}</strong>
        </p>
      )}
    </div>
  );
};

export default StepProjectBasics;
