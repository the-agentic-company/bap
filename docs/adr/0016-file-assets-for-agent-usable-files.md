# File Assets for Agent-Usable Files

Bap uses **File Assets** as the shared storage identity for durable agent-usable files: **Message Attachments**, **Coworker Documents**, **Skill Documents**, and **Sandbox Files**. Product concepts reference **File Assets** rather than carrying bytes or private storage keys directly, so upload, storage, staging, deletion, and filename reuse follow one model across agent workflows. Profile images, workspace images, and bug report attachments remain outside this model because they are not agent-usable runtime files.

Existing product rows keep their identity during migration. Legacy file-bearing rows are backfilled to reference **File Assets**, new writes go through **File Assets**, and old per-table storage fields can be removed only after production data no longer depends on them.
