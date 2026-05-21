import { ConversationExecutionEnvironmentProvider } from "./conversation-environment";

export class DockerExecutionEnvironmentProvider extends ConversationExecutionEnvironmentProvider {
  constructor() {
    super("docker");
  }
}
