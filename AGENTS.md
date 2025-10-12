# Broker GPT — Agent Notes

## Way of Work
- Tuân thủ lý thuyết đã được thừa nhận; không tự chế thuật toán khi thiếu bằng chứng học thuật/thực nghiệm.
- Đánh giá thị trường dựa trên dữ liệu chuẩn; thiếu dữ liệu thì dừng pipeline và yêu cầu bổ sung.
- Fail fast, không nuốt lỗi; tránh try/except rộng và luôn raise với thông điệp rõ ràng, có log.
  - CI/Automation policy: pipeline phải FAIL (exit != 0) khi thiếu cấu hình/bí mật bắt buộc. Không dùng cảnh báo để tiếp tục chạy (không "proceed without ..."). Ví dụ: thiếu `.codex/config.toml` hoặc secret → dừng ngay với thông báo rõ ràng.
- Xác thực dữ liệu vào/ra; kiểm tra schema/cột/độ dài; numeric null phải bị chặn thay vì đoán.
- Không ẩn default trong engine; giá trị mặc định đặt tại schema/baseline và tài liệu hoá rõ ràng.
- Giữ contract rõ giữa module; không trả về DataFrame rỗng hoặc `{}` khi pipeline lỗi; surface nguyên nhân cho caller.
- Calibrate dựa trên dữ liệu khách quan; mọi chủ quan chỉ áp khi đã chốt trong policy và được ghi chú.
- Nhật ký minh bạch; ghi diagnostics để người dùng hiểu quyết định, tránh “blackbox”.
- Mặc định ổn định — không dùng env để tắt/bật; hành vi cố định bằng defaults hợp lý và policy.
- Schema & test đi cùng thay đổi: khi chỉnh schema/policy, cập nhật baseline, whitelist overrides liên quan và test/fixtures tương ứng (giữ tests xanh).
- Test/coverage trước bàn giao: chạy `./broker.sh tests` (có thể bật coverage) sau mỗi thay đổi quan trọng.

Overlay policy (baseline bất biến)
- Baseline: `config/policy_default.json` không bị workflow ghi đè.
- Nightly overlay (tùy chọn): `config/policy_nightly_overrides.json` do calibrators sinh; commit riêng khi có thay đổi.
- Unified overlay (hiện hành): `config/policy_overrides.json` do unified tuner publish (đã hợp nhất các điều chỉnh); lưu trong repo để audit/rollback.
- **Không chỉnh tay `config/policy_overrides.json` và tuyệt đối không gợi ý chỉnh tay.** File này luôn được sinh bởi bước calibration/tuning; mọi thay đổi thủ công sẽ bị phiên chạy kế tiếp ghi đè, đồng thời phá vỡ audit trail.
- Back‑compat: `config/policy_ai_overrides.json` trước đây do tuner sinh; hiện pipeline không tạo nữa nhưng engine vẫn MERGE nếu file tồn tại.
- Runtime merge: engine hợp nhất baseline → nightly (nếu có) → ai (nếu có) → legacy `config/policy_overrides.json` thành `out/orders/policy_overrides.json` và dùng cho phiên chạy.

Generated artifacts
- `out/orders/policy_overrides.json` là file MACHINE‑GENERATED cho mỗi phiên/tune; engine thêm `"_meta".machine_generated = true` và timestamp. Tuyệt đối không chỉnh tay; mọi thay đổi sẽ bị ghi đè. Nếu cần thay đổi, cập nhật overlay tại `config/` và để engine hợp nhất ở runtime.
- **Lưu ý bổ sung:** `config/policy_overrides.json` cũng là artefact do calibrators xuất bản. Không chỉnh tay hoặc đề xuất chỉnh tay file này; thay đổi phải đi qua quy trình tune/calibration.

## Phân chia tài liệu (Docs structure)
- `README.md`: chỉ tập trung vào cách sử dụng (install, chạy nhanh, I/O, lệnh tiện ích, server usage cơ bản, FAQ). Không chứa chi tiết kỹ thuật/thuật toán; nếu cần, đặt link trỏ sang SYSTEM_DESIGN.md.
- `SYSTEM_DESIGN.md`: kiến trúc, pipeline, thuật toán/quy tắc ra quyết định, calibrations, execution diagnostics, policy overlays, lộ trình tích hợp (API, async runner). Đây là nơi chứa toàn bộ chi tiết kỹ thuật.
- `AGENTS.md`: Way of Work, tiêu chuẩn CI/Fail‑fast, quy tắc dữ liệu & contract, convention khi đóng góp. Đồng thời duy trì quy ước phân chia tài liệu này.

## Tooling & CI (Codex)
- Postinstall (Node): chạy `scripts/postinstall-codex-global.js` sau `npm install` để:
  - Xác thực Codex CLI từ `node_modules` (`node .../codex.js --version`, không cài global).
  - Sao chép `.codex/config.toml` từ repo → `~/.codex/config.toml` với quyền `0600` (thiếu → fail‑fast `exit 2`).
  - `~/.codex/auth.json` chỉ được ghi khi có `CODEX_AUTH_JSON` trong env (local: có thì ghi, không thì bỏ qua; CI: step cấu hình trong workflow sẽ fail‑fast nếu secret thiếu).
- GitHub Actions `.github/workflows/tuning.yml` (hiện hành):
  - Chạy unified tune → tạo `out/orders/policy_overrides.json` và publish sang `config/policy_overrides.json`.
  - Chạy `./broker.sh orders` để sinh lệnh từ sample portfolio; in `orders_print.txt` và head/tail `orders_final.csv` vào log.
  - In diff giữa overlay mới và snapshot cũ vào log; khi fail in thêm tail log + file lỗi Codex `out/debug/codex_policy_error_*.txt`.
  - Không upload artifact; commit & push `config/policy_overrides.json` sau khi hoàn tất (nhánh `main`).

## Khẩu vị đầu tư
- Ưu tiên chốt lời và cắt lỗ sớm, có thể thực hiện theo từng phần để khóa lợi nhuận hoặc hạn chế rủi ro dần.
- Khi điều kiện thuận lợi, giải ngân bằng các lệnh mua nhỏ, tránh dồn vào một giao dịch quá lớn.
- Không chờ “thời điểm hoàn hảo” mới mua khối lượng lớn; thay vào đó phân bổ giao dịch theo nhịp thị trường.

Policy biên tập:
- Khi thêm chi tiết kỹ thuật mới, cập nhật `SYSTEM_DESIGN.md` và chỉ bổ sung gạch đầu dòng/link tối thiểu ở `README.md` nếu ảnh hưởng tới cách dùng.
- Nếu `README.md` bị “phình” bởi nội dung kỹ thuật, tách/chuyển sang `SYSTEM_DESIGN.md` và rút gọn còn phần hướng dẫn sử dụng.
- Đây là công cụ phục vụ cá nhân, chỉ quan tâm trạng thái HEAD hiện tại; không cần lưu tài liệu hoặc ghi chú về mã cũ đã bị thay thế.
