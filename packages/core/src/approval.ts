import { ApprovalGate, ApprovalRequest, ApprovalStatus } from "@clpc/types";

export class AutoApproveGate implements ApprovalGate {
  async requestApproval(_request: ApprovalRequest): Promise<ApprovalStatus> {
    return "approved";
  }
}

export class PolicyApprovalGate implements ApprovalGate {
  constructor(
    private readonly policy: (
      request: ApprovalRequest
    ) => ApprovalStatus | Promise<ApprovalStatus>
  ) {}

  async requestApproval(request: ApprovalRequest): Promise<ApprovalStatus> {
    return this.policy(request);
  }
}