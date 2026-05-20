groups:
  - name: cmdclaw-__CMDCLAW_ALERT_ENV__-runtime
    interval: 30s
    rules:
      - alert: CmdClawRpcErrorRateElevated
        expr: |
          (
            sum(increase(cmdclaw_rpc_requests_total{status_code=~"5.."}[15m]))
            /
            clamp_min(sum(increase(cmdclaw_rpc_requests_total[15m])), 1)
          ) > 0.05
          and
          sum(increase(cmdclaw_rpc_requests_total[15m])) >= 20
        for: 10m
        labels:
          severity: warning
          service_name: cmdclaw-web
        annotations:
          summary: RPC 5xx rate is elevated.
          description: More than 5% of RPC requests have returned 5xx responses for the last 15 minutes.

      - alert: CmdClawWorkerJobErrorRateElevated
        expr: |
          (
            sum(increase(cmdclaw_worker_jobs_total{status="error"}[30m]))
            /
            clamp_min(sum(increase(cmdclaw_worker_jobs_total[30m])), 1)
          ) > 0.10
          and
          sum(increase(cmdclaw_worker_jobs_total[30m])) >= 10
        for: 10m
        labels:
          severity: warning
          service_name: cmdclaw-worker
        annotations:
          summary: Worker job error rate is elevated.
          description: More than 10% of processed BullMQ jobs have failed during the last 30 minutes.

      - alert: CmdClawBullmqBacklogGrowing
        expr: |
          max(cmdclaw_bullmq_jobs{state="waiting"}) > 20
          or
          max(cmdclaw_bullmq_oldest_waiting_job_age_seconds) > 300
        for: 15m
        labels:
          severity: warning
          service_name: cmdclaw-worker
        annotations:
          summary: BullMQ backlog is growing.
          description: The primary queue has been backed up for at least 15 minutes.

      - alert: VectorComponentErrors
        expr: |
          sum by (component_id, component_type, component_kind) (
            increase(vector_component_errors_total[30m])
          ) > 100
        for: 10m
        labels:
          severity: warning
          service_name: vector
        annotations:
          summary: Vector is reporting component errors.
          description: A Vector component has emitted more than 100 internal errors in the last 30 minutes.

      - alert: VectorDroppedEvents
        expr: |
          sum by (component_id, component_type, component_kind) (
            increase(vector_component_discarded_events_total{intentional="false"}[30m])
          ) > 50
        for: 10m
        labels:
          severity: warning
          service_name: vector
        annotations:
          summary: Vector has dropped unintentional events.
          description: A Vector component has discarded more than 50 telemetry events because of errors in the last 30 minutes.
