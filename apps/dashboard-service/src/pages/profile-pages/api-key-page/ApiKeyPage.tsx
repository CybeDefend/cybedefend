import React from "react";
import { useSelector } from "react-redux";
import { RootState } from "../../../server/store";
import { useAuth } from "@/edition/auth/useAuth";
import ApiKeyTemplate from "./ApiKeyTemplate";

const ApiKeyPage: React.FC = () => {
  const user = useSelector((state: RootState) => state.user);
  const { loading: authLoading } = useAuth();

  return <ApiKeyTemplate user={user} authLoading={authLoading} />;
};

export default ApiKeyPage;
