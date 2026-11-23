import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { useAuth } from "@/edition/auth/useAuth";
import { updateUserProfile } from "../../../server/services/userService";
import { AppDispatch, RootState } from "../../../server/store";
import { updateUserNotification } from "../../../server/store/userSlice";
import { clearScannerStorage } from "../../../utils/function/utils";
import ProfileTemplate from "./AccountTemplate";
import { EDITION } from "@/edition/edition";
import { ChangePasswordForm } from "./ChangePasswordForm";

const AccountPage: React.FC = () => {
  const { t } = useTranslation();
  const user = useSelector((state: RootState) => state.user);

  const dispatch = useDispatch<AppDispatch>();

  const { loading } = useAuth();

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(
    user.notification ?? true
  );

  useEffect(() => {
    setNotificationsEnabled(user.notification);
  }, [user.notification]);

  const handleToggleNotifications = async (enabled: boolean) => {
    try {
      await updateUserProfile(enabled);
      setNotificationsEnabled(enabled);
      dispatch(updateUserNotification(enabled));
      toast.success(
        enabled ? t('pages.accountPage.notifications.enabled') : t('pages.accountPage.notifications.disabled')
      );
    } catch (error) {
      toast.error(t('pages.accountPage.notifications.updateFailed'));
      setNotificationsEnabled((prev) => !prev);
    }
  };

  const handleDeleteAccount = () => {
    toast.success(t('pages.accountPage.accountDeleted'));
  };

  useEffect(() => {
    clearScannerStorage();
  }, []);

  return (
    <ProfileTemplate
      email={user.email}
      notificationsEnabled={notificationsEnabled}
      onToggleNotifications={handleToggleNotifications}
      onDeleteAccount={handleDeleteAccount}
      loading={loading}
      // The Community Edition changes the password here (no identity
      // provider account page); the e-mail address stays read only.
      passwordChange={EDITION === "community" ? <ChangePasswordForm /> : null}
    />
  );
};

export default AccountPage;
