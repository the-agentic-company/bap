import { ConversationExecutionEnvironmentProvider } from "./conversation-environment";

export class E2BExecutionEnvironmentProvider extends ConversationExecutionEnvironmentProvider {
  constructor() {
    super("e2b");
  }
}
