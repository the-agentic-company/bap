import { ConversationExecutionEnvironmentProvider } from "./conversation-environment";

export class DaytonaExecutionEnvironmentProvider extends ConversationExecutionEnvironmentProvider {
  constructor() {
    super("daytona");
  }
}
