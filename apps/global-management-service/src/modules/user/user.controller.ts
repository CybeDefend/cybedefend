import { Controller } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';

import {
  UserExistenceResponse,
  UserInformationsResponse,
  UpdateUserProfileRequest,
  UserUpdateResponse,
  UserCreateRequest,
  UserCreateResponse,
  UserDeleteRequest,
  UserDeleteResponse,
  GetUserProfileRequest,
  GetUserProfileResponse,
  UserGetByEmailRequest,
  UserGetByIdRequest,
  UserGetByIdsRequest,
  UserGetByIdsResponse,
  UserExistenceRequest,
  ListPersonalAccessTokensRequest,
  ListPersonalAccessTokensResponse,
  CreatePersonalAccessTokenRequest,
  CreatePersonalAccessTokenResponse,
  DeletePersonalAccessTokenRequest,
  DeletePersonalAccessTokenResponse,
  UpdatePersonalAccessTokenNameRequest,
  UpdatePersonalAccessTokenNameResponse,
  CountPatsForOrgRequest,
  CountPatsForOrgResponse,
  DeleteAllPatsForOrgRequest,
  DeleteAllPatsForOrgResponse,
} from '@grpc/global-management/user';

import { UserService } from './user.service';
import {
  UserServiceController,
  UserServiceControllerMethods,
} from '@grpc/global-management/global_management';

@UserServiceControllerMethods()
@Controller()
export class UserController implements UserServiceController {
  constructor(
    private readonly userService: UserService,
    private readonly logger: Logger,
  ) {}

  async checkExistence(
    request: UserExistenceRequest,
  ): Promise<UserExistenceResponse> {
    if (!request.email) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Email is required',
      });
    }
    return await this.userService.checkExistence(request);
  }

  async getByEmail(
    request: UserGetByEmailRequest,
  ): Promise<UserInformationsResponse> {
    if (!request.email) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Email is required',
      });
    }
    return await this.userService.getByEmail(request);
  }

  async getById(
    request: UserGetByIdRequest,
  ): Promise<UserInformationsResponse> {
    if (!request.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'User ID is required',
      });
    }
    return await this.userService.getById(request);
  }

  /** Several users at once; the bound and the blank ids are the service's. */
  async getByIds(request: UserGetByIdsRequest): Promise<UserGetByIdsResponse> {
    return await this.userService.getByIds(request);
  }

  async updateUser(
    request: UpdateUserProfileRequest,
  ): Promise<UserUpdateResponse> {
    if (!request.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'User ID is required for update',
      });
    }
    return this.userService.update(request);
  }

  async createUser(request: UserCreateRequest): Promise<UserCreateResponse> {
    if (!request.email || !request.firstName) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Email and firstName are required',
      });
    }
    return await this.userService.create(request);
  }

  async deleteUser(request: UserDeleteRequest): Promise<UserDeleteResponse> {
    if (!request.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'User ID is required for delete',
      });
    }
    return await this.userService.delete(request);
  }

  async getUserProfile(
    request: GetUserProfileRequest,
  ): Promise<GetUserProfileResponse> {
    if (!request.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'User ID is required',
      });
    }
    return await this.userService.getProfile(request);
  }

  // ─── Personal Access Tokens ────────────────────────────────────

  async listPersonalAccessTokens(
    request: ListPersonalAccessTokensRequest,
  ): Promise<ListPersonalAccessTokensResponse> {
    if (!request.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'User ID is required',
      });
    }
    return await this.userService.listPersonalAccessTokens(request);
  }

  async createPersonalAccessToken(
    request: CreatePersonalAccessTokenRequest,
  ): Promise<CreatePersonalAccessTokenResponse> {
    if (!request.userId || !request.name) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'User ID and token name are required',
      });
    }
    return await this.userService.createPersonalAccessToken(request);
  }

  async deletePersonalAccessToken(
    request: DeletePersonalAccessTokenRequest,
  ): Promise<DeletePersonalAccessTokenResponse> {
    if (!request.userId || !request.tokenName) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'User ID and token name are required',
      });
    }
    return await this.userService.deletePersonalAccessToken(request);
  }

  async updatePersonalAccessTokenName(
    request: UpdatePersonalAccessTokenNameRequest,
  ): Promise<UpdatePersonalAccessTokenNameResponse> {
    if (!request.userId || !request.currentName || !request.newName) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'User ID, current name, and new name are required',
      });
    }
    return await this.userService.updatePersonalAccessTokenName(request);
  }

  async countPatsForOrg(
    request: CountPatsForOrgRequest,
  ): Promise<CountPatsForOrgResponse> {
    if (!request.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Organization ID is required',
      });
    }
    return await this.userService.countPatsForOrg(request);
  }

  async deleteAllPatsForOrg(
    request: DeleteAllPatsForOrgRequest,
  ): Promise<DeleteAllPatsForOrgResponse> {
    if (!request.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Organization ID is required',
      });
    }
    return await this.userService.deleteAllPatsForOrg(request);
  }
}
