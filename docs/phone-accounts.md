# 手机号账号与旧账号迁移

## 注册和登录

新注册只接受 `phoneNumber/password/nickname`。手机号必须严格匹配 ASCII `^1[0-9]{10}$`，不 trim，不接受 `+86`、空格、短横线、字母或数值类型；这里只是登录标识，没有短信验证码、号码归属验证或实名认证。

注册事务创建 User、Wallet、`INITIAL_GRANT` 和 Session。数据库唯一索引保证同手机号并发最多一个成功且不会留下孤儿 Wallet/Ledger/Session。内部 username 由服务器随机生成且不包含手机号。注册页只接受手机号；登录页字段为“手机号或管理员账号”，开发/测试管理员可直接输入 `admin`，普通用户继续使用手机号。服务端字段仍为 `identifier`，生产不开放用户名注册。

开发/测试 Seed 号码为 `19900000001` 至 `19900000005`；管理员同时可使用 `admin`。密码来自本机 `DEV_SEED_PASSWORD`，Seed 会修复管理员密码但不会重置普通既有用户密码，密码值不写入仓库或日志。

## 旧账号绑定

没有 phone 的旧用户可通过受控的开发/测试兼容流程登录后，向 `POST /api/account/phone` 提交 `phoneNumber/currentPassword/operationId`。服务端重新验证当前密码、锁 User、检查格式/唯一性并写幂等回执；只能绑定一次，不能普通改绑。绑定前后 User ID、Wallet、历史、房间和 Session 归属不变；绑定后可用手机号登录。该兼容能力不在公开登录页暴露。

## 隐私

数据库和认证服务可使用完整号码；本人 DTO 只返回 `hasPhoneNumber` 与 `phoneMasked`（例如 `138****8000`）。完整号码不得进入公共 Room/Member/Seat/Table State/Socket/Hand/Replay DTO、URL、local/session storage、PWA Cache、普通日志、错误、Wallet metadata 或付费授权 metadata。对手只能看到昵称和内部公开 user ID。

管理员可提交完整手机号做精确搜索或后四位搜索，但响应仍只返回掩码，Fastify 日志同时 redact 搜索输入。`admin:create` 使用相同正式手机号规则、隐藏密码和 Argon2id；本阶段仍不发送短信、不验证号码归属，也不允许管理员修改用户手机号。
