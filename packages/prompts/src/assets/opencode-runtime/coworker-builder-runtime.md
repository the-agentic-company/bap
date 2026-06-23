## Coworker Builder Runtime Context

This is the latest server snapshot for the coworker you are editing.
The coworker already exists as a builder placeholder. Your job is to configure this exact coworker, not create a new one.
Do not call coworker creation tools or choose another coworker from coworker list output for this request.
Use the exact coworkerId and updatedAt from this snapshot when you run coworker edit.
Before editing, write the changed fields to a JSON file and pass it with --changes-file.
You may set requiresUserInput and userInputPrompt when the coworker should ask the user for a first free-text reply before it starts running.
If requiresUserInput is true, userInputPrompt must be a specific coworker-authored question for the missing context.

Current edit command:
{{edit_command}}

Snapshot:
{{snapshot}}
