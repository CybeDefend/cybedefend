import gatewayAPI from "../../api/gatewayAPI";

export interface SlackInstallation {
  /**
   * false => the organization has no integration. The endpoint answers 200,
   * so a rejected promise now means a REAL failure (backend down, auth) and
   * must not be rendered as "not installed".
   */
  isConfigured: boolean;
  id: string;
  teamId: string;
  teamName: string;
  organizationId: string;
  installedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlackChannel {
  channelId: string;
  name: string;
  isPrivate: boolean;
}

export interface SlackChannelMapping {
  channelId: string;
  channelName: string;
  isConfigured: boolean;
}

export const getSlackInstallation = async (
  organizationId: string
): Promise<SlackInstallation> => {
  try {
    const response = await gatewayAPI.get<SlackInstallation>(
      `/organization/${organizationId}/slack/installation`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Asks the gateway for a single-use OAuth `state` bound to the current user
 * and this organization. Slack hands it back to the callback page, which
 * sends it with the code: the gateway refuses a callback whose state it did
 * not issue to that user for that organization (CSRF on the install flow).
 */
export const createSlackOAuthState = async (
  organizationId: string
): Promise<string> => {
  const response = await gatewayAPI.post<{ state: string }>(
    `/organization/${organizationId}/slack/install/state`
  );
  if ([200, 201, 202].includes(response.status)) {
    return response.data.state;
  }
  throw new Error(`Unexpected status code: ${response.status}`);
};

export const installSlackIntegration = async (
  organizationId: string,
  payload: { code: string; redirectUri: string; state: string }
): Promise<any> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/slack/install/callback`,
      payload
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

export const disconnectSlack = async (
  organizationId: string
): Promise<any> => {
  try {
    const response = await gatewayAPI.delete(
      `/organization/${organizationId}/slack/disconnect`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

export const listSlackChannels = async (
  organizationId: string
): Promise<SlackChannel[]> => {
  try {
    const response = await gatewayAPI.get<{ channels: SlackChannel[] }>(
      `/organization/${organizationId}/slack/channels`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data.channels;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

export const setProjectSlackChannel = async (
  organizationId: string,
  projectId: string,
  channelId: string,
  channelName: string
): Promise<any> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/project/${projectId}/slack/channel`,
      { channelId, channelName }
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

export const removeProjectSlackChannel = async (
  organizationId: string,
  projectId: string
): Promise<any> => {
  try {
    const response = await gatewayAPI.delete(
      `/organization/${organizationId}/project/${projectId}/slack/channel`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

export const getProjectSlackChannel = async (
  projectId: string
): Promise<SlackChannelMapping> => {
  try {
    const response = await gatewayAPI.get<SlackChannelMapping>(
      `/project/${projectId}/slack/channel`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};
