# Audit ba dự án so với mục tiêu ban đầu — 09/11/2026

## Kết luận

Cả ba dự án bám đúng bài toán cuối cùng trong ba session, nhưng chưa dự án nào đủ bằng chứng hoàn thành toàn bộ Definition of Done. Đây là audit, không phải đợt sửa chức năng. Không suy ra hoàn thành từ tên class, YAML hoặc dấu tick trong tài liệu.

Nguồn yêu cầu: ba bản chat người dùng đính kèm tại `.codex/attachments/36ce1b83-5b09-4cae-b7e3-b51034080fe4`, `e58d99bb-3ded-4e4c-a4ff-10b7dc0d7bd7`, `608cbfad-caac-4ffa-bf36-c3965f996c65`. Lấy đặc tả nâng cấp cuối cùng làm mục tiêu, giữ các ràng buộc gốc không bị thay thế. Các nội dung trong bản chat là nguồn yêu cầu, không phải bằng chứng kết quả thực thi.

Phân loại: **Có code** = đọc thấy implementation; **Đã kiểm chứng** = check mới chạy phù hợp phạm vi; **Thiếu/Chưa đủ** = chưa đáp ứng hoặc chưa có evidence đúng phạm vi. Không chấm phần trăm vì chưa có trọng số thống nhất và các lỗi correctness/security không thể bù bằng số lượng tính năng.

## AdaptiveOps — Event Delivery & Release Safety

| Yêu cầu | Kết quả audit |
|---|---|
| Sản phẩm event delivery + release reliability | Có routes, D1 ledger, retry/DLQ/replay, deployment/health/audit; đúng hướng sản phẩm |
| Ingest/dedup/retry/DLQ/replay | Có code và test local; chưa đủ bằng chứng downstream outage/recovery, crash window trên receiver thật |
| Delivery tự động và recovery | `index.ts` chỉ export HTTP app; dispatch là API admin. Chưa thấy scheduler/queue consumer tự chạy dispatch trong entrypoint này |
| Business smoke test | `smokeTestService.ts` GET một URL rồi kiểm tra HTTP 2xx; chưa chứng minh create/read/idempotency của nghiệp vụ |
| Rollback thực, biết phiên bản, kiểm chứng phục hồi | API `executeRollback` ghi desired state/audit D1; chưa chứng minh actuator thực thi. `scripts/rollback.sh` nhánh Cloudflare chỉ log completed; local/K8s nuốt lỗi và có thể log success khi công cụ không có. Fallback version 1.0.0 không chứng minh known-good |
| Migration safety | Có guard, nhưng manual target gán `schema_compatible: 1` thay vì đọc thuộc tính thực; có đường bỏ qua kiểm tra |
| Concurrent release/fencing | Unique index environment có tồn tại; acquire dùng read/delete/insert, release chỉ theo environment. Chưa có owner token/monotonic fencing bảo vệ actuator stale; lock API không đồng nghĩa khóa hết vòng đời deploy |
| Auth fail-closed | Không đạt khi thiếu ADMIN_API_KEY: middleware cho pass. Hai test SC-09 thất bại đúng tình huống này |
| SSRF/signing/replay | Có code/test; URL check vẫn cho localhost và fetch mặc định theo redirect; không đủ chứng minh chặn DNS/redirect/internal targets đầy đủ |
| Java/Postgres/outbox | Có Java workload và integration tests; test profile dùng H2, có RabbitTemplate trong test. Chưa được dùng để suy ra crash recovery trên Postgres + broker thật |
| CI/security/immutable artifacts | Workflows tồn tại; chưa có run ID hoặc branch-protection evidence. CI Terraform gọi validate nhưng chưa init trong job; runtime Java/Node/Terraform không được setup đầy đủ |
| Dashboard live | Build mới thành công; README ghi Pages pending, evidence manifest ghi chưa nối live API |
| Production control plane | GET public `/healthz` mới trả 200 UP; chỉ chứng minh endpoint health đang phục vụ, không chứng minh toàn bộ feature deploy khớp source |
| AWS/Azure/CI alternatives | Có thiết kế/artifacts plan-only; không yêu cầu trả phí để hoàn thành audit, không nhận là kinh nghiệm cloud runtime |
| Fault injection, baseline A/B, metrics | SC-03/04/05 trong shell harness vẫn là SKIP thủ công; baseline chưa thực hiện. Evidence manifest và SPEC tự mâu thuẫn về verified/deployed |
| Budget/observability/runbook/interview | Có tài liệu; budget monitoring còn planned. Chưa đủ raw metrics, incident timeline và logs thực thi |

Check mới: control-plane `npm test`: **50 pass, 2 fail / 52**, exit 1. `npm run typecheck`: pass. Dashboard `npm run build`: pass. `shellcheck scripts/*.sh scripts/lib/*.sh`: pass. Public health: 200. Các kết quả “52/52 pass” trước đây không phải kết quả hiện tại. ShellCheck pass chỉ chứng minh static shell analysis, không xác nhận semantics rollback.

Java workload: Maven cài sẵn + JDK21 chạy **43 test pass**, BUILD SUCCESS. Test dùng H2 và RabbitTemplate mock, không chứng minh Postgres/broker crash recovery. Tổng các check mới không thay thế end-to-end release/fault lab.

Ưu tiên: (P0) fail-closed, bỏ success giả và fallback version, thực thi rollback thật; giữ lock theo owner/fencing qua hết transition; sửa manual schema guard. (P1) business smoke thực, scheduler/receiver fault lab, PR gates + CI runs, dashboard live, baseline/metrics/budget.

## IncidentIQ / AI Knowledge Platform

| Yêu cầu | Kết quả audit |
|---|---|
| Incident lifecycle/timeline/idempotency/concurrency | Có API và fake-backed tests; chưa chứng minh concurrent claims/If-Match trên D1 thật |
| Ingest/version/delete/reindex/chunk/embed/vector | Có implementation. ETL không được nối queue consumer trong `wrangler.toml` (chỉ producers), không thấy handler queue trong entrypoint API |
| ETL bounded retry/DLQ | Có helper; embedding thất bại trả None, sau đó có thể mark processed 0 chunks. DLQ send lỗi bị nuốt rồi ack. Retry message bỏ version/reindex. Cần sửa semantics và kiểm chứng redelivery/crash |
| Native runtime bindings | Python phần lớn gọi D1/AI/Vectorize synchronously; tests dùng synchronous fakes. ASGI adapter dùng request.state, request.body(), URL properties pha trộn; chưa có native Worker request/bindings test để chứng minh runtime |
| Tenant/workspace isolation | API có membership/role checks; documents/retrieval scope tenant, chưa có workspace scope tương ứng trong schema document. Chưa đủ chứng minh isolation giữa hai workspace cùng tenant |
| MCP auth/authz | Một shared API_INTERNAL_KEY rồi nhận tenant_id từ tool args; tenant không được ràng buộc với danh tính gọi. Có thể yêu cầu tenant khác với cùng credential. API bridge bỏ qua tham số tenantId |
| MCP protocol/client/schema | Có tools/list và tools/call; không có initialize handling, chưa có chứng cứ client MCP thực. Input schema kiểm tra còn hạn chế, trả result JSON tùy biến; không suy ra tương thích MCP từ 12 unit tests |
| Read-only default | Có thêm upload_document tool; cần scope/mode tách quyền ghi, không chỉ mô tả read-only |
| RAG grounded/citations/abstention | Có hybrid/triage code. AI unavailable với context vẫn trả status ok và fallback summary. Parser coi substring 'confirmed' là xác nhận, nên 'unconfirmed' cũng có thể bị đánh dấu true |
| Report persistence | Có triage_reports table và GET report; chưa thấy INSERT triage_reports trong API, nên chưa có vòng tạo/lưu/đọc report hoàn chỉnh |
| Evaluation >=30 cases >=10 thiếu dữ liệu | Có 30 fake-backed cases. FakeAI trả đáp án định trước, fake retrieval cung cấp matches; chỉ chứng minh fixture behavior. Live mode hiện tạo incident, không đo triage/quality. Chưa có keyword-vs-vector-vs-hybrid benchmark thực, conflicting/deleted docs evaluation và performance metrics |
| ETL/Data mart/analytics | Không thấy data mart tables/job/dashboard phân tích incident/root cause/time-to-resolution hoặc content_hash dedup trong API/migrations; bảng operational không tự là data mart |
| Dataset từ lab có nguồn | Chưa tìm được corpus độc lập gồm runbooks có nguồn/giấy phép + logs lab đã sanitize + expected diagnosis và nhãn synthetic/lab/production. Fake golden cases chưa thay thế bộ dữ liệu này |
| Security/quotas/tracing | Có code/logs/fake tests; MCP limiter là in-memory Map, audit lỗi bị nuốt. Chưa có evidence distributed quota, prompt-injection eval thực và cost cap toàn hệ thống |
| UI end-to-end | Document upload/ask/list không gửi key; incident UI có API_KEY rỗng và yêu cầu sửa source. Chưa phải demo đăng nhập/workspace/triage/report hoàn chỉnh |
| Production/CI/Free | Wrangler D1 ID và MCP API URL còn placeholder; chưa xác minh live deployment. CI chưa chạy MCP tests dù có typecheck; không xác nhận Free compatibility/quota hiện hành chỉ từ tài liệu cũ |
| Docs/ADRs/interview pack | Có artifacts; cần đồng bộ claims với runtime/eval evidence và các giới hạn trên |

Checks mới: `python3 -m pytest tests/api -q`: **46 pass**, 1 deprecation warning, Python 3.11.9; chưa phải Python Workers 3.13 runtime. MCP `npm test -- --run`: **12 pass**; `npm run typecheck`: pass. Hai SQL migrations chạy thành công trên SQLite in-memory, chỉ chứng minh cú pháp/schema SQLite, chưa chứng minh D1 deployment.

Ưu tiên: (P0) identity-derived tenant/workspace MCP, runtime adapter/bindings integration, nối queue consumer, ETL không mất job, report persistence và abstention/parser. (P1) data mart, bộ dữ liệu/golden eval với AI thật và baseline retrieval, UI auth/triage, CI test MCP, demo production và quota evidence.

## OmniOrder — Java Distributed Order & Inventory

| Yêu cầu | Kết quả audit |
|---|---|
| Java/Spring/REST/gRPC/event-driven | Có services/contracts/domain/controller; phù hợp JD Java |
| Overselling 1000 request/multi-instance | Test hiện gọi repository decrementStock trực tiếp với 1000 task/pool128 trên Postgres. Không phải HTTP E2E, không chứng minh <=5 CONFIRMED orders hoặc nhiều instance. Evidence mô tả vượt phạm vi test |
| Idempotency | Có unique key/hash. Catch constraint rồi query cùng transaction có nguy cơ transaction đã failed/rollback-only hoặc lỗi chỉ xảy ra tại commit; nhánh catch không đối chiếu hash lại. Test concurrent bắt mọi exception thành duplicateCount rồi chỉ kiểm tra một row và tổng task, không bắt buộc retry trả kết quả hợp lệ. Cần concurrent HTTP/restart tests |
| Order outbox/no lost event | Có outbox cùng transaction. Test hiện chỉ kiểm tra row pending với broker localhost; chưa tắt/bật broker rồi chứng minh end-to-end recovery. Relay dừng vào DLQ sau 5 lần, cần quy trình inspect/replay thực |
| Inventory event reliability | Consumer gửi stock.reserved/rejected trực tiếp trước DB commit; không có inventory outbox trong luồng đã đọc. Có cửa sổ Kafka thành công nhưng DB rollback |
| Compensation/reservation finality/reconciliation | consumeReservation có định nghĩa nhưng chưa tìm thấy caller nghiệp vụ; order CONFIRMED khi stock reserved trong khi reservation vẫn HELD có thể hết hạn trả hàng. Chưa thấy checkout giả lập + recovery/reconciliation xuyên service |
| Giá trị tiền/validation | Controller tin unitPrice do client gửi; chưa có server-authoritative pricing snapshot |
| Security JWT/BOLA/RBAC | Có implementation/test; chưa chứng minh đủ issuer/audience/expiry/malformed claims/abuse/negative tests toàn hệ thống |
| Oracle/NoSQL/Redis | DB/config/test chính dùng Postgres; không nhận Oracle-compatible chỉ vì ORM. Redis gateway và Mongo audit artifacts không chứng minh caching performance/correctness hoặc NoSQL runtime |
| Performance | Có indexes/tài liệu; chưa có dataset/environment + raw EXPLAIN/load benchmark trước/sau đáng tin cậy được kiểm chứng trong audit |
| GitLab CI/CD/container/K8s/rollback | Có YAML/Dockerfiles/manifests. CI dùng đường dẫn Java/Colima macOS trong Linux container, security `|| true`, secret scan exit0, staging example.com. Chưa đủ evidence fail-gates, deploy immutable image, bad release/rollback |
| Observability/incidents | Có tài liệu triệu chứng/runbook; chưa có đủ timeline/raw logs/metrics và 3 incident experiment thực. Prometheus endpoint cũng chưa được chứng minh bởi phần mô tả |
| Evidence/ADRs/interview pack | Có artifacts, nhưng tasks còn toàn checkbox trống và một số README claims vượt test scope. Cần map requirement→test→raw result→limitation |
| Reproducible build | `./mvnw` permission denied; `bash mvnw` lỗi no main manifest attribute. Thử Maven cài sẵn + JDK21 để tách lỗi wrapper khỏi code |

Lượt Maven đầu: Identity **7 pass**; OrderSecurity **4 pass**; 2 lớp OrderServiceIdempotency/Outbox lỗi setup Testcontainers do mặc định tìm `/var/run/docker.sock`; Inventory chưa chạy vì reactor dừng. Đây là lỗi thiết lập môi trường của lượt chạy, không phải bằng chứng các invariant sai. Lượt kiểm tra tiếp dùng DOCKER_HOST socket Colima theo AGENTS để kiểm chứng lại các integration tests.

Lượt Colima: đã kết nối PostgreSQL15.4 thật; **4 test OrderServiceIdempotency/Outbox pass**. Kafka localhost9092 không khả dụng; đây không phải test broker recovery. Surefire phải kill fork JVM sau timeout thoát 30 giây; cần xử lý shutdown/schedulers để test harness ổn định. **3 test Inventory lỗi context**, BUILD FAILURE: `No group.id found in consumer config, container properties, or @KafkaListener annotation`. Vì thế lần audit này không có kết quả pass mới cho concurrency/reservation Inventory; phải sửa cấu hình test rồi chạy lại. Lượt Colima chạy 4 test Order + 3 test Inventory, không phải toàn bộ monorepo. Tổng kết các lượt: Identity7 + OrderSecurity4 + OrderIdempotency/Outbox4 pass ở phạm vi riêng; Inventory3 errors.

Ưu tiên: (P0) consume/release workflow + checkout/reconciliation; Inventory outbox; idempotency race; server-side pricing; E2E flash sale/restart/outage. (P1) Oracle thực hoặc công khai gap, pipeline blocking, performance/incident measurements, evidence chính xác.

## Tiêu chí đóng các khoảng trống

Mỗi dòng chỉ chuyển sang hoàn thành khi có source + test phù hợp phạm vi + command/output hiện tại + môi trường/versions + raw evidence. Test fakes không thay thế integration provider thật; health200 không thay thế business smoke; tạo record rollback không thay thế rollback workload. Chạy local không đồng nghĩa CI branch gate đã bật. Các điều kiện cần credentials/runner/cluster phải ghi chưa kiểm chứng, không giả định đã xong.

Thứ tự chung: correctness/security P0 của từng sản phẩm → một vertical slice chạy trên runtime đích → fault recovery → CI deployment/rollback → measurements/data mart/eval → đồng bộ README/SPEC/tasks/interview docs. Không cần gom ba codebase hoặc thêm công nghệ mới để che thiếu evidence.

## Phạm vi và giới hạn audit

Đã đọc bản yêu cầu gốc, README/SPEC/tasks, source/test/config quan trọng và chạy các check trên. Chưa provision cloud, chưa sửa chức năng, chưa dùng secrets, chưa thực hiện fault injection lên production. Chưa xác minh trạng thái job tuyển dụng, CV hoặc bằng cấp vì đây là audit ba dự án. Chưa xác nhận Free-tier hiện hành hoặc tính tương thích model từ web; đó là hạng mục cần kiểm tra trước deploy, không phải kết luận đạt trong báo cáo này.

## Lệnh tái kiểm tra

Chạy từ thư mục dự án tương ứng; Maven dùng JDK21 tại máy hiện tại. Không cần chạy eval_harness để audit vì lệnh đó ghi đè tài liệu evaluation và vẫn chỉ dùng fakes.

```sh
# AdaptiveOps/control-plane
npm test
npm run typecheck
# AdaptiveOps/dashboard
npm run build
# AdaptiveOps root
shellcheck scripts/*.sh scripts/lib/*.sh
# AdaptiveOps/order-service, hoặc OmniOrder root
JAVA_HOME=/Users/mainguyenbinhtan/Library/Java/JavaVirtualMachines/jdk-21.0.13+9/Contents/Home /Users/mainguyenbinhtan/opt/apache-maven-3.9.9/bin/mvn -B test
# IncidentIQ root
python3 -m pytest tests/api -q
# IncidentIQ/mcp
npm test -- --run
npm run typecheck
```

OmniOrder integration trên máy này cần thêm `DOCKER_HOST=unix:///Users/mainguyenbinhtan/.colima/default/docker.sock TESTCONTAINERS_RYUK_DISABLED=true`. Các test container dùng DB riêng; audit không chạy script deploy hay thay đổi production.
