# Third-party notices

CybeDefend AppSec Community Edition is licensed under the GNU Affero General Public License v3 ([LICENSE](LICENSE)).
Its container images and its dashboard bundle also contain third-party software. Each component stays under its own licence, listed here; nothing in this file changes those licences.

This file is generated from the lockfiles of the services, the packages a production install lays out, and the packages installed in the images. It is refreshed when a dependency changes.

1. [npm packages](#1-npm-packages)
2. [NOTICE files](#2-notice-files)
3. [Fonts, icons and logos](#3-fonts-icons-and-logos)
4. [Container images: operating-system packages](#4-container-images-operating-system-packages)
5. [Licence texts](#5-licence-texts)

## 1. npm packages

Every package a production install of each service puts in its image, and every package the dashboard bundle is built from.
The "Text" column points to the licence text in section 5; the copyright lines are those of the package's own licence file (or its declared author when that file has none).
A package that ships a NOTICE file has it reproduced in section 2.

| Package | Version | Licence | Copyright | Text | Used by |
|---|---|---|---|---|---|
| `@alloc/quick-lru` | 5.2.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | dashboard |
| `@aws-sdk/checksums` | 3.1002.5 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/client-s3` | 3.1169.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/core` | 3.981.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T3](#t3) | file-management |
| `@aws-sdk/credential-provider-env` | 3.972.84 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/credential-provider-http` | 3.972.86 | Apache-2.0 | (author) AWS SDK for JavaScript Team |  | file-management |
| `@aws-sdk/credential-provider-ini` | 3.973.30 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/credential-provider-login` | 3.972.92 | Apache-2.0 | (author) AWS SDK for JavaScript Team |  | file-management |
| `@aws-sdk/credential-provider-node` | 3.972.97 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/credential-provider-process` | 3.972.84 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/credential-provider-sso` | 3.973.28 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/credential-provider-web-identity` | 3.972.90 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/middleware-sdk-s3` | 3.972.89 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/nested-clients` | 3.998.3 | Apache-2.0 | (author) AWS SDK for JavaScript Team |  | file-management |
| `@aws-sdk/s3-request-presigner` | 3.1169.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/signature-v4-multi-region` | 3.996.52 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/token-providers` | 3.1166.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/types` | 3.975.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws-sdk/xml-builder` | 3.972.43 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@aws/lambda-invoke-store` | 0.3.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works | [T4](#t4) | file-management |
| `@babel/code-frame` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | [T1](#t1) | dashboard |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | [T1](#t1) | dashboard |
| `@babel/runtime` | 7.29.15 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | [T1](#t1) | dashboard |
| `@babel/runtime` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | [T1](#t1) | dashboard |
| `@borewit/text-codec` | 0.2.2 | MIT | Copyright © 2025 Borewit | [T5](#t5) | analysis-reporting, gateway, mcp, security-scanning |
| `@borewit/text-codec` | 0.2.3 | MIT | Copyright © 2025 Borewit | [T5](#t5) | external-integrations, file-management, global-management, policy-management |
| `@bufbuild/protobuf` | 2.12.0 | (Apache-2.0 AND BSD-3-Clause) |  |  | gateway |
| `@bufbuild/protobuf` | 2.17.0 | (Apache-2.0 AND BSD-3-Clause) |  |  | file-management, global-management |
| `@cspotcode/source-map-support` | 0.8.1 | MIT | Copyright (c) 2014 Evan Wallace | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@emnapi/core` | 1.11.3 | MIT | Copyright (c) 2021-present Toyobayashi | [T1](#t1) | global-management |
| `@emnapi/runtime` | 1.11.3 | MIT | Copyright (c) 2021-present Toyobayashi | [T1](#t1) | global-management |
| `@emnapi/wasi-threads` | 1.2.3 | MIT | Copyright (c) 2021-present Toyobayashi | [T1](#t1) | global-management |
| `@fastify/accept-negotiator` | 2.0.1 | MIT | Copyright (c) 2022 The Fastify Team | [T6](#t6) | gateway |
| `@fastify/accept-negotiator` | 2.1.2 | MIT | Copyright (c) 2022-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway |
| `@fastify/ajv-compiler` | 4.0.6 | MIT | Copyright (c) 2022-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `@fastify/busboy` | 3.2.4 | MIT | Copyright Brian White. All rights reserved.<br>Copyright (c) 2021-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway |
| `@fastify/compress` | 8.3.1 | MIT | Copyright (c) 2017-present The Fastify team | [T7](#t7) | gateway |
| `@fastify/cors` | 11.4.1 | MIT | Copyright (c) 2018-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `@fastify/deepmerge` | 3.2.4 | MIT | Copyright (c) 2022-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `@fastify/error` | 4.2.0 | MIT | Copyright (c) 2020 Fastify | [T1](#t1) | gateway |
| `@fastify/error` | 4.2.1 | MIT | Copyright (c) 2020-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `@fastify/error` | 4.3.0 | MIT | Copyright (c) 2020-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway |
| `@fastify/fast-json-stringify-compiler` | 5.1.0 | MIT | Copyright (c) 2022-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `@fastify/formbody` | 9.0.1 | MIT | Copyright (c) 2018-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `@fastify/forwarded` | 3.0.2 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson<br>Copyright (c) 2021-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `@fastify/merge-json-schemas` | 0.2.1 | MIT | Copyright (c) 2024 Fastify | [T1](#t1) | gateway, mcp |
| `@fastify/middie` | 9.3.6 | MIT | Copyright (c) 2017-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `@fastify/multipart` | 10.1.9 | MIT | Copyright (c) 2017-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway |
| `@fastify/proxy-addr` | 5.1.0 | MIT | Copyright (c) 2014-2016 Douglas Christopher Wilson<br>Copyright (c) 2021-present The Fastify team | [T7](#t7) | gateway, mcp |
| `@fastify/rate-limit` | 10.3.0 | MIT | Copyright (c) 2018 Fastify | [T1](#t1) | mcp |
| `@fastify/send` | 4.2.1 | MIT | Copyright (c) 2012 TJ Holowaychuk<br>Copyright (c) 2014-2022 Douglas Christopher Wilson<br>Copyright (c) 2023-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway |
| `@fastify/static` | 10.1.12 | MIT | Copyright (c) 2017-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway |
| `@floating-ui/core` | 1.8.0 | MIT | Copyright (c) 2021-present Floating UI contributors<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T8](#t8) | dashboard |
| `@floating-ui/dom` | 1.8.0 | MIT | Copyright (c) 2021-present Floating UI contributors<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T8](#t8) | dashboard |
| `@floating-ui/react-dom` | 2.1.9 | MIT | Copyright (c) 2021-present Floating UI contributors<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T8](#t8) | dashboard |
| `@floating-ui/utils` | 0.2.12 | MIT | Copyright (c) 2021-present Floating UI contributors<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T8](#t8) | dashboard |
| `@fontsource/jetbrains-mono` | 5.3.0 | OFL-1.1 | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) JetBrainsMono-Italic[wght].ttf: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)<br>copyright statement(s).<br>Copyright Holder. This restriction only applies to the primary font name as<br>Copyright Holder(s) and the Author(s) or with their explicit written<br>COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, | [T9](#t9) | analysis-reporting |
| `@fontsource/rubik` | 5.3.0 | OFL-1.1 | Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik) Rubik-Italic[wght].ttf: Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik)<br>copyright statement(s).<br>Copyright Holder. This restriction only applies to the primary font name as<br>Copyright Holder(s) and the Author(s) or with their explicit written<br>COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, | [T9](#t9) | analysis-reporting |
| `@fortawesome/fontawesome-common-types` | 6.7.2 | MIT | Copyright (c) 2024 Fonticons, Inc. (https://fontawesome.com)<br>copyright statement(s).<br>Copyright Holder. This restriction only applies to the primary font name as<br>Copyright Holder(s) and the Author(s) or with their explicit written<br>COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,<br>Copyright 2024 Fonticons, Inc. | [T10](#t10) | dashboard |
| `@fortawesome/fontawesome-svg-core` | 6.7.2 | MIT | Copyright (c) 2024 Fonticons, Inc. (https://fontawesome.com)<br>copyright statement(s).<br>Copyright Holder. This restriction only applies to the primary font name as<br>Copyright Holder(s) and the Author(s) or with their explicit written<br>COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,<br>Copyright 2024 Fonticons, Inc. | [T10](#t10) | dashboard |
| `@fortawesome/free-brands-svg-icons` | 6.7.2 | (CC-BY-4.0 AND MIT) | Copyright (c) 2024 Fonticons, Inc. (https://fontawesome.com)<br>copyright statement(s).<br>Copyright Holder. This restriction only applies to the primary font name as<br>Copyright Holder(s) and the Author(s) or with their explicit written<br>COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,<br>Copyright 2024 Fonticons, Inc. | [T10](#t10) | dashboard |
| `@fortawesome/free-solid-svg-icons` | 6.7.2 | (CC-BY-4.0 AND MIT) | Copyright (c) 2024 Fonticons, Inc. (https://fontawesome.com)<br>copyright statement(s).<br>Copyright Holder. This restriction only applies to the primary font name as<br>Copyright Holder(s) and the Author(s) or with their explicit written<br>COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,<br>Copyright 2024 Fonticons, Inc. | [T10](#t10) | dashboard |
| `@grpc/grpc-js` | 1.14.5 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright {yyyy} {name of copyright owner} | [T2](#t2) | analysis-reporting |
| `@grpc/grpc-js` | 1.14.7 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright {yyyy} {name of copyright owner} | [T2](#t2) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@grpc/proto-loader` | 0.8.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright {yyyy} {name of copyright owner} | [T2](#t2) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@hapi/address` | 5.1.1 | BSD-3-Clause | Copyright (c) 2019-2022, Sideway, Inc. and Project contributors | [T11](#t11) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@hapi/formula` | 3.0.2 | BSD-3-Clause | Copyright (c) 2019-2020, Sideway. Inc, and project contributors | [T11](#t11) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@hapi/hoek` | 11.0.7 | BSD-3-Clause | Copyright (c) 2011-2022, Project contributors<br>Copyright (c) 2011-2020, Sideway Inc<br>Copyright (c) 2011-2014, Walmart<br>Copyright (c) 2011, Yahoo Inc. | [T12](#t12) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@hapi/pinpoint` | 2.0.1 | BSD-3-Clause | Copyright (c) 2019-2020, Sideway. Inc, and project contributors | [T12](#t12) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@hapi/tlds` | 1.1.6 | BSD-3-Clause | Copyright (c) 2019-2022, Sideway, Inc. and Project contributors | [T11](#t11) | analysis-reporting |
| `@hapi/tlds` | 1.1.7 | BSD-3-Clause | Copyright (c) 2019-2022, Sideway, Inc. and Project contributors | [T11](#t11) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@hapi/topo` | 6.0.2 | BSD-3-Clause | Copyright (c) 2012-2022, Project contributors<br>Copyright (c) 2012-2020, Sideway Inc<br>Copyright (c) 2012-2014, Walmart. | [T12](#t12) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@hono/node-server` | 2.1.8 | MIT | Copyright (c) 2022 - present, Yusuke Wada and Hono contributors | [T1](#t1) | mcp |
| `@ioredis/commands` | 1.10.0 | MIT | Copyright (c) 2022 Zihua Li<br>Copyright (c) 2015 NodeRedis | [T5](#t5) | analysis-reporting, external-integrations, gateway, mcp, policy-management, security-scanning |
| `@ioredis/commands` | 1.5.1 | MIT | Copyright (c) 2022 Zihua Li<br>Copyright (c) 2015 NodeRedis | [T5](#t5) | analysis-reporting, global-management |
| `@isaacs/cliui` | 8.0.2 | ISC | Copyright (c) 2015, Contributors | [T13](#t13) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@isaacs/nonrecursive-glob-match` | 1.1.0 | BlueOak-1.0.0 | copyright in it. | [T14](#t14) | gateway |
| `@jest/expect-utils` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `@jest/schemas` | 29.6.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `@jest/types` | 29.6.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT | Copyright 2024 Justin Ridgewell &lt;justin@ridgewell.name&gt; | [T15](#t15) | dashboard |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT | Copyright 2019 Justin Ridgewell &lt;jridgewell@google.com&gt; | [T15](#t15) | analysis-reporting, dashboard, security-scanning |
| `@jridgewell/resolve-uri` | 3.1.3 | MIT | Copyright 2019 Justin Ridgewell &lt;jridgewell@google.com&gt; | [T15](#t15) | external-integrations, file-management, global-management, policy-management |
| `@jridgewell/sourcemap-codec` | 1.5.5 | MIT | Copyright 2024 Justin Ridgewell &lt;justin@ridgewell.name&gt; | [T15](#t15) | analysis-reporting, dashboard, security-scanning |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT | Copyright 2024 Justin Ridgewell &lt;justin@ridgewell.name&gt; | [T15](#t15) | external-integrations, file-management, global-management, policy-management |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT | Copyright 2024 Justin Ridgewell &lt;justin@ridgewell.name&gt; | [T15](#t15) | dashboard |
| `@jridgewell/trace-mapping` | 0.3.9 | MIT | Copyright 2022 Justin Ridgewell &lt;justin@ridgewell.name&gt; | [T15](#t15) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@js-sdsl/ordered-map` | 4.4.2 | MIT | Copyright (c) 2021 Zilong Yao | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@jsep-plugin/assignment` | 1.3.0 | MIT | Copyright (c) 2013 Stephen Oney, https://ericsmekens.github.io/jsep/ | [T15](#t15) | security-scanning |
| `@jsep-plugin/regex` | 1.0.4 | MIT | Copyright (c) 2013 Stephen Oney, https://ericsmekens.github.io/jsep/ | [T15](#t15) | security-scanning |
| `@kubernetes/client-node` | 1.4.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright {yyyy} {name of copyright owner} | [T2](#t2) | security-scanning |
| `@lukeed/csprng` | 1.1.0 | MIT | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@lukeed/ms` | 2.0.2 | MIT | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) | [T1](#t1) | gateway, mcp |
| `@microsoft/fetch-event-source` | 2.0.1 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@microsoft/tsdoc` | 0.17.1 | MIT | Copyright (c) Microsoft Corporation. All rights reserved. | [T1](#t1) | gateway |
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT | Copyright (c) 2024 Anthropic, PBC | [T1](#t1) | mcp |
| `@msgpackr-extract/msgpackr-extract-darwin-arm64` | 3.0.4 | MIT | (author) Kris Zyp |  | analysis-reporting |
| `@msgpackr-extract/msgpackr-extract-darwin-arm64` | 3.0.7 | MIT | (author) Kris Zyp |  | external-integrations, policy-management |
| `@msgpackr-extract/msgpackr-extract-darwin-x64` | 3.0.4 | MIT | (author) Kris Zyp |  | analysis-reporting |
| `@msgpackr-extract/msgpackr-extract-darwin-x64` | 3.0.7 | MIT | (author) Kris Zyp |  | external-integrations, policy-management |
| `@msgpackr-extract/msgpackr-extract-linux-arm64` | 3.0.4 | MIT | (author) Kris Zyp |  | analysis-reporting |
| `@msgpackr-extract/msgpackr-extract-linux-arm64` | 3.0.7 | MIT | (author) Kris Zyp |  | external-integrations, policy-management |
| `@msgpackr-extract/msgpackr-extract-linux-arm` | 3.0.4 | MIT | (author) Kris Zyp |  | analysis-reporting |
| `@msgpackr-extract/msgpackr-extract-linux-arm` | 3.0.7 | MIT | (author) Kris Zyp |  | external-integrations, policy-management |
| `@msgpackr-extract/msgpackr-extract-linux-x64` | 3.0.4 | MIT | (author) Kris Zyp |  | analysis-reporting |
| `@msgpackr-extract/msgpackr-extract-linux-x64` | 3.0.7 | MIT | (author) Kris Zyp |  | external-integrations, policy-management |
| `@msgpackr-extract/msgpackr-extract-win32-x64` | 3.0.4 | MIT | (author) Kris Zyp |  | analysis-reporting |
| `@msgpackr-extract/msgpackr-extract-win32-x64` | 3.0.7 | MIT | (author) Kris Zyp |  | external-integrations, policy-management |
| `@napi-rs/wasm-runtime` | 0.2.12 | MIT | Copyright (c) 2020-present LongYinan<br>Copyright (c) 2018 GitHub | [T17](#t17) | global-management |
| `@nestjs/axios` | 12.0.2 | MIT | Copyright (c) 2020-2022 Kamil Mysliwiec | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `@nestjs/bull-shared` | 12.0.2 | MIT | Copyright (c) Kamil Mysliwiec | [T1](#t1) | analysis-reporting, external-integrations, policy-management |
| `@nestjs/bullmq` | 12.0.2 | MIT | Copyright (c) Kamil Mysliwiec | [T1](#t1) | analysis-reporting, external-integrations, policy-management |
| `@nestjs/common` | 12.5.0 | MIT | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T18](#t18) | analysis-reporting |
| `@nestjs/common` | 12.5.1 | MIT | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T18](#t18) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@nestjs/config` | 12.1.1 | MIT | Copyright (c) 2020-2022 Kamil Mysliwiec | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@nestjs/core` | 12.5.0 | MIT | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T18](#t18) | analysis-reporting |
| `@nestjs/core` | 12.5.1 | MIT | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T18](#t18) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@nestjs/jwt` | 12.0.5 | MIT | Copyright (c) 2018-2022 Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T1](#t1) | gateway |
| `@nestjs/mapped-types` | 12.0.1 | MIT | Copyright (c) 2020-2022 Kamil Mysliwiec | [T18](#t18) | gateway |
| `@nestjs/microservices` | 12.5.0 | MIT | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T18](#t18) | analysis-reporting |
| `@nestjs/microservices` | 12.5.1 | MIT | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T18](#t18) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@nestjs/platform-express` | 12.5.0 | MIT | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T18](#t18) | analysis-reporting |
| `@nestjs/platform-express` | 12.5.1 | MIT | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T18](#t18) | external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `@nestjs/platform-fastify` | 12.5.1 | MIT | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T18](#t18) | gateway, mcp |
| `@nestjs/schedule` | 12.0.4 | MIT | Copyright (c) Kamil Mysliwiec | [T18](#t18) | analysis-reporting, file-management, security-scanning |
| `@nestjs/swagger` | 12.1.2 | MIT | Copyright (c) 2020-2022 Kamil Mysliwiec | [T1](#t1) | gateway |
| `@nestjs/typeorm` | 12.0.3 | MIT | Copyright (c) 2017-2022 Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@node-rs/argon2-android-arm-eabi` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-android-arm64` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-darwin-arm64` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-darwin-x64` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-freebsd-x64` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-linux-arm-gnueabihf` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-linux-arm64-gnu` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-linux-arm64-musl` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-linux-x64-gnu` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-linux-x64-musl` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-wasm32-wasi` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-win32-arm64-msvc` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-win32-ia32-msvc` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2-win32-x64-msvc` | 2.0.2 | MIT |  |  | global-management |
| `@node-rs/argon2` | 2.0.2 | MIT | Copyright (c) 2020-present LongYinan | [T1](#t1) | global-management |
| `@nodelib/fs.scandir` | 2.1.5 | MIT | Copyright (c) Denis Malinochkin | [T5](#t5) | dashboard |
| `@nodelib/fs.stat` | 2.0.5 | MIT | Copyright (c) Denis Malinochkin | [T5](#t5) | dashboard |
| `@nodelib/fs.walk` | 1.2.8 | MIT | Copyright (c) Denis Malinochkin | [T5](#t5) | dashboard |
| `@octokit/auth-app` | 8.3.1 | MIT | Copyright (c) 2019 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/auth-oauth-app` | 9.0.5 | MIT | Copyright (c) 2019 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/auth-oauth-device` | 8.0.5 | MIT | Copyright (c) 2021 Octokit contributors | [T1](#t1) | external-integrations |
| `@octokit/auth-oauth-user` | 6.0.4 | MIT | Copyright (c) 2021 Octokit contributors | [T1](#t1) | external-integrations |
| `@octokit/auth-token` | 6.0.0 | MIT | Copyright (c) 2019 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/core` | 7.0.8 | MIT | Copyright (c) 2019 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/endpoint` | 11.0.5 | MIT | Copyright (c) 2018 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/graphql` | 9.0.5 | MIT | Copyright (c) 2018 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/oauth-authorization-url` | 8.0.0 | MIT | Copyright (c) 2019 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/oauth-methods` | 6.0.5 | MIT | Copyright (c) 2021 Octokit contributors | [T1](#t1) | external-integrations |
| `@octokit/openapi-types` | 27.0.0 | MIT | Copyright (c) GitHub 2025 - Licensed as MIT. | [T15](#t15) | external-integrations |
| `@octokit/openapi-types` | 28.0.0 | MIT | Copyright (c) GitHub 2025 - Licensed as MIT. | [T15](#t15) | external-integrations |
| `@octokit/openapi-types` | 29.0.1 | MIT | Copyright (c) GitHub 2025 - Licensed as MIT. | [T15](#t15) | external-integrations |
| `@octokit/plugin-paginate-rest` | 14.0.0 | MIT |  | [T20](#t20) | external-integrations |
| `@octokit/plugin-request-log` | 6.0.0 | MIT | (author) Gregor Martynus | [T21](#t21) | external-integrations |
| `@octokit/plugin-rest-endpoint-methods` | 17.0.0 | MIT | (author) Gregor Martynus | [T20](#t20) | external-integrations |
| `@octokit/plugin-retry` | 8.1.1 | MIT | Copyright (c) 2018 Octokit contributors | [T1](#t1) | external-integrations |
| `@octokit/plugin-throttling` | 11.0.5 | MIT | Copyright (c) 2018 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/request-error` | 7.1.2 | MIT | Copyright (c) 2019 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/request` | 10.0.16 | MIT | Copyright (c) 2018 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/rest` | 22.0.1 | MIT | Copyright (c) 2012 Cloud9 IDE, Inc. (Mike de Boer)<br>Copyright (c) 2017-2018 Octokit contributors | [T19](#t19) | external-integrations |
| `@octokit/types` | 16.0.0 | MIT | (author) Gregor Martynus | [T20](#t20) | external-integrations |
| `@octokit/types` | 17.0.0 | MIT | (author) Gregor Martynus | [T20](#t20) | external-integrations |
| `@octokit/types` | 18.0.0 | MIT | (author) Gregor Martynus | [T20](#t20) | external-integrations |
| `@opentelemetry/api-logs` | 0.212.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/api-logs` | 0.217.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `@opentelemetry/api-logs` | 0.218.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/api-logs` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/api-logs` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/api-logs` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/api` | 1.9.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/auto-instrumentations-node` | 0.81.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/configuration` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/configuration` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/configuration` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/context-async-hooks` | 2.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/context-async-hooks` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/context-async-hooks` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/core` | 2.10.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/core` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/core` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-logs-otlp-grpc` | 0.212.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/exporter-logs-otlp-grpc` | 0.217.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `@opentelemetry/exporter-logs-otlp-grpc` | 0.218.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-logs-otlp-grpc` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-logs-otlp-grpc` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-logs-otlp-grpc` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-logs-otlp-http` | 0.212.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/exporter-logs-otlp-http` | 0.217.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `@opentelemetry/exporter-logs-otlp-http` | 0.218.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-logs-otlp-http` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-logs-otlp-http` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-logs-otlp-http` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-logs-otlp-proto` | 0.212.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/exporter-logs-otlp-proto` | 0.217.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `@opentelemetry/exporter-logs-otlp-proto` | 0.218.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-logs-otlp-proto` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-logs-otlp-proto` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-logs-otlp-proto` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-metrics-otlp-grpc` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-metrics-otlp-grpc` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-metrics-otlp-grpc` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-metrics-otlp-http` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-metrics-otlp-http` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-metrics-otlp-http` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-metrics-otlp-proto` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-metrics-otlp-proto` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-metrics-otlp-proto` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-prometheus` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-prometheus` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-prometheus` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-trace-otlp-grpc` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-trace-otlp-grpc` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-trace-otlp-grpc` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-trace-otlp-http` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-trace-otlp-http` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-trace-otlp-http` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-trace-otlp-proto` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/exporter-trace-otlp-proto` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-trace-otlp-proto` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-zipkin` | 2.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/exporter-zipkin` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/exporter-zipkin` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/host-metrics` | 0.38.3 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-amqplib` | 0.70.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-aws-lambda` | 0.75.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-aws-sdk` | 0.78.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-bunyan` | 0.68.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-cassandra-driver` | 0.68.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-connect` | 0.66.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-cucumber` | 0.39.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-dataloader` | 0.40.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-dns` | 0.66.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-express` | 0.71.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-fs` | 0.42.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-generic-pool` | 0.66.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-graphql` | 0.71.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-grpc` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/instrumentation-grpc` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/instrumentation-hapi` | 0.69.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-host-metrics` | 0.6.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-http` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/instrumentation-http` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/instrumentation-ioredis` | 0.71.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-kafkajs` | 0.32.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-knex` | 0.67.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-koa` | 0.71.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-lru-memoizer` | 0.67.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-memcached` | 0.66.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-mongodb` | 0.76.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-mongoose` | 0.69.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-mysql2` | 0.69.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-mysql` | 0.69.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-nestjs-core` | 0.70.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-net` | 0.67.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-openai` | 0.21.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-oracledb` | 0.48.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-pg` | 0.76.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-pino` | 0.66.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-pino` | 0.69.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-redis` | 0.71.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-restify` | 0.68.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-router` | 0.67.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-runtime-node` | 0.36.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-socket.io` | 0.70.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-tedious` | 0.42.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-undici` | 0.33.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation-winston` | 0.68.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/instrumentation` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/instrumentation` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/otlp-exporter-base` | 0.212.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/otlp-exporter-base` | 0.217.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `@opentelemetry/otlp-exporter-base` | 0.218.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/otlp-exporter-base` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/otlp-exporter-base` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/otlp-exporter-base` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/otlp-grpc-exporter-base` | 0.212.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/otlp-grpc-exporter-base` | 0.217.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `@opentelemetry/otlp-grpc-exporter-base` | 0.218.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/otlp-grpc-exporter-base` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/otlp-grpc-exporter-base` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/otlp-grpc-exporter-base` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/otlp-transformer` | 0.212.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/otlp-transformer` | 0.217.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `@opentelemetry/otlp-transformer` | 0.218.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/otlp-transformer` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/otlp-transformer` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/otlp-transformer` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/propagator-aws-xray` | 2.2.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/propagator-b3` | 2.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/propagator-b3` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/propagator-b3` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/propagator-jaeger` | 2.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/propagator-jaeger` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/propagator-jaeger` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/redis-common` | 0.38.3 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/resource-detector-alibaba-cloud` | 0.38.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/resource-detector-aws` | 2.23.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/resource-detector-azure` | 0.31.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/resource-detector-container` | 0.8.14 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/resource-detector-gcp` | 0.58.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/resources` | 2.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/resources` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/resources` | 2.5.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/resources` | 2.7.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management, security-scanning |
| `@opentelemetry/resources` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/sdk-logs` | 0.212.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/sdk-logs` | 0.217.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `@opentelemetry/sdk-logs` | 0.218.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/sdk-logs` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/sdk-logs` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/sdk-logs` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/sdk-metrics` | 2.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/sdk-metrics` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/sdk-metrics` | 2.5.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/sdk-metrics` | 2.7.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management, security-scanning |
| `@opentelemetry/sdk-metrics` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/sdk-node` | 0.220.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/sdk-node` | 0.223.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/sdk-node` | 0.223.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/sdk-trace-base` | 2.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/sdk-trace-base` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/sdk-trace-base` | 2.5.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/sdk-trace-base` | 2.7.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management, security-scanning |
| `@opentelemetry/sdk-trace-base` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/sdk-trace-node` | 2.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/sdk-trace-node` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/sdk-trace-node` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/sdk-trace` | 2.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `@opentelemetry/sdk-trace` | 2.12.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/sdk-trace` | 2.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@opentelemetry/semantic-conventions` | 1.40.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/semantic-conventions` | 1.41.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `@opentelemetry/semantic-conventions` | 1.43.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp |
| `@opentelemetry/semantic-conventions` | 1.45.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `@opentelemetry/sql-common` | 0.42.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@permify/permify-node` | 1.6.10 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | gateway |
| `@permify/permify-node` | 1.7.4 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | global-management |
| `@pinojs/redact` | 0.4.0 | MIT | Copyright (c) 2025 pinojs contributors | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@pkgjs/parseargs` | 0.11.0 | MIT | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@playwright/test` | 1.59.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works | [T22](#t22) | dashboard |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@protobufjs/codegen` | 2.0.5 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@protobufjs/eventemitter` | 1.1.1 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@protobufjs/fetch` | 1.1.1 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@protobufjs/utf8` | 1.1.1 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | analysis-reporting, mcp, security-scanning |
| `@protobufjs/utf8` | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T23](#t23) | external-integrations, file-management, gateway, global-management, policy-management |
| `@puppeteer/browsers` | 3.0.4 | Apache-2.0 | (author) The Chromium Authors |  | analysis-reporting |
| `@radix-ui/primitive` | 1.1.7 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-arrow` | 1.1.15 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-arrow` | 1.1.16 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-checkbox` | 1.3.12 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-collection` | 1.1.16 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-compose-refs` | 1.1.5 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-context` | 1.2.2 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-dialog` | 1.1.23 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-direction` | 1.1.5 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-dismissable-layer` | 1.1.19 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-dismissable-layer` | 1.1.20 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-dropdown-menu` | 2.1.25 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-focus-guards` | 1.1.6 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-focus-scope` | 1.1.16 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-focus-scope` | 1.2.0 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-id` | 1.1.4 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-menu` | 2.1.25 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-popover` | 1.1.23 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-popper` | 1.3.7 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-popper` | 1.3.8 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-portal` | 1.1.17 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-portal` | 1.1.18 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-presence` | 1.1.10 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-presence` | 1.1.11 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-primitive` | 2.1.10 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-primitive` | 2.1.11 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-roving-focus` | 1.1.20 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-slot` | 1.3.3 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-slot` | 1.4.0 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-switch` | 1.3.8 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-tabs` | 1.1.22 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-toggle-group` | 1.1.20 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-toggle` | 1.1.19 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-tooltip` | 1.2.16 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-use-callback-ref` | 1.1.4 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-use-controllable-state` | 1.2.6 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-use-effect-event` | 0.0.5 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-use-is-hydrated` | 0.1.3 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-use-layout-effect` | 1.1.4 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-use-rect` | 1.1.4 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-use-size` | 1.1.4 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-use-size` | 1.1.5 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/react-visually-hidden` | 1.2.11 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@radix-ui/rect` | 1.1.3 | MIT | Copyright (c) 2022 WorkOS | [T1](#t1) | dashboard |
| `@reduxjs/toolkit` | 2.11.2 | MIT | Copyright (c) 2018 Mark Erikson | [T1](#t1) | dashboard |
| `@scarf/scarf` | 1.4.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2020 Scarf Systems, Inc. | [T3](#t3) | gateway |
| `@sinclair/typebox` | 0.27.10 | MIT | Copyright (c) 2017-2023 Haydn Paterson (sinclair) &lt;haydn.developer@gmail.com&gt; | [T24](#t24) | dashboard |
| `@smithy/core` | 3.40.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@smithy/credential-provider-imds` | 4.5.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@smithy/fetch-http-handler` | 5.8.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@smithy/node-http-handler` | 4.14.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@smithy/signature-v4` | 5.7.5 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@smithy/types` | 4.20.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. | [T2](#t2) | file-management |
| `@sqltools/formatter` | 1.2.5 | MIT | Copyright (c) 2019-present Matheus Teixeira | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@standard-schema/spec` | 1.1.0 | MIT | Copyright (c) 2024 Colin McDonnell | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@standard-schema/utils` | 0.3.0 | MIT | Copyright (c) 2024 Fabian Hiller | [T1](#t1) | dashboard |
| `@tailwindcss/forms` | 0.5.11 | MIT | Copyright (c) Tailwind Labs, Inc. | [T1](#t1) | dashboard |
| `@tailwindcss/typography` | 0.5.20 | MIT | Copyright (c) Tailwind Labs, Inc. | [T1](#t1) | dashboard |
| `@testing-library/dom` | 10.4.0 | MIT | Copyright (c) 2017 Kent C. Dodds | [T5](#t5) | dashboard |
| `@testing-library/user-event` | 14.6.13 | MIT | Copyright (c) 2020 Giorgio Polvara | [T5](#t5) | dashboard |
| `@tokenizer/inflate` | 0.6.0 | MIT | Copyright (c) 2024, Borewit<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR | [T25](#t25) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@tokenizer/token` | 0.3.0 | MIT | (author) Borewit |  | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@tsconfig/node10` | 1.0.12 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, security-scanning |
| `@tsconfig/node10` | 1.0.14 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | external-integrations, file-management, global-management, policy-management |
| `@tsconfig/node12` | 1.0.11 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@tsconfig/node14` | 1.0.3 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@tsconfig/node16` | 1.0.4 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@tybys/wasm-util` | 0.10.4 | MIT | Copyright (c) 2022-present Toyobayashi | [T1](#t1) | global-management |
| `@types/aria-query` | 5.0.4 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/aws-lambda` | 8.10.161 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, gateway, mcp, security-scanning |
| `@types/aws-lambda` | 8.10.164 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | external-integrations, file-management, global-management, policy-management |
| `@types/connect` | 3.4.38 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@types/d3-array` | 3.2.2 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/d3-color` | 3.1.3 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/d3-ease` | 3.0.2 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/d3-interpolate` | 3.0.4 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/d3-path` | 3.1.1 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/d3-scale` | 4.0.9 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/d3-shape` | 3.1.8 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/d3-time` | 3.0.4 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/d3-timer` | 3.0.2 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/debug` | 4.1.13 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/estree-jsx` | 1.0.5 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/estree` | 1.0.9 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/hast` | 3.0.4 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/istanbul-lib-coverage` | 2.0.6 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/istanbul-lib-report` | 3.0.3 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/istanbul-reports` | 3.0.4 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/jest` | 29.5.14 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/js-yaml` | 4.0.9 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | security-scanning |
| `@types/jsonwebtoken` | 9.0.10 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | gateway |
| `@types/luxon` | 3.7.1 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, security-scanning |
| `@types/luxon` | 3.7.6 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | file-management |
| `@types/mdast` | 4.0.4 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/memcached` | 2.2.10 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@types/ms` | 2.1.0 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard, gateway |
| `@types/node-fetch` | 2.6.13 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | security-scanning |
| `@types/node` | 24.12.2 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting |
| `@types/node` | 24.12.4 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard, gateway, mcp, security-scanning |
| `@types/node` | 24.19.2 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | external-integrations, file-management, global-management, policy-management |
| `@types/pako` | 2.0.4 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/pg-pool` | 2.0.7 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@types/pg` | 8.15.6 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@types/pg` | 8.23.1 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `@types/prismjs` | 1.26.6 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/raf` | 3.4.3 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/react-dom` | 19.2.7 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/react` | 19.2.18 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/stack-utils` | 2.0.3 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/stream-buffers` | 3.0.8 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | security-scanning |
| `@types/trusted-types` | 2.0.7 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/unist` | 2.0.11 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/unist` | 3.0.3 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/use-sync-external-store` | 0.0.6 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/validator` | 13.15.10 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `@types/yargs-parser` | 21.0.3 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@types/yargs` | 17.0.35 | MIT | Copyright (c) Microsoft Corporation. | [T16](#t16) | dashboard |
| `@ungap/structured-clone` | 1.3.0 | ISC | Copyright (c) 2021, Andrea Giammarchi, @WebReflection<br>copyright notice and this permission notice appear in all copies. | [T26](#t26) | dashboard |
| `abort-controller-x` | 0.5.0 | MIT | Copyright (c) 2020 Deeplay | [T5](#t5) | gateway, global-management |
| `abort-controller` | 3.0.0 | MIT | Copyright (c) 2017 Toru Nagashima | [T1](#t1) | external-integrations, file-management, gateway |
| `abstract-logging` | 2.0.1 | MIT | (author) James Sumners |  | gateway, mcp |
| `accepts` | 2.0.0 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `acorn-import-attributes` | 1.9.5 | MIT | Copyright (c) 2023 Sven Sauleau | [T1](#t1) | analysis-reporting, gateway, mcp, security-scanning |
| `acorn-walk` | 8.3.5 | MIT | Copyright (C) 2012-2020 by various contributors (see AUTHORS) | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `acorn` | 8.16.0 | MIT | Copyright (C) 2012-2022 by various contributors (see AUTHORS) | [T1](#t1) | analysis-reporting, mcp, security-scanning |
| `acorn` | 8.18.0 | MIT | Copyright (C) 2012-2022 by various contributors (see AUTHORS) | [T1](#t1) | gateway |
| `acorn` | 8.19.0 | MIT | Copyright (C) 2012-2022 by various contributors (see AUTHORS) | [T1](#t1) | external-integrations, file-management, global-management, policy-management |
| `adm-zip` | 0.6.1 | MIT | Copyright (c) 2012 Another-D-Mention Software and other contributors | [T1](#t1) | external-integrations |
| `ae-cvss-calculator` | 1.0.12 | Apache-2.0 | Copyright 2024 the original author or authors. | [T27](#t27) | analysis-reporting |
| `agent-base` | 6.0.2 | MIT | (author) Nathan Rajlich |  | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `agent-base` | 7.1.4 | MIT | Copyright (c) 2013 Nathan Rajlich &lt;nathan@tootallnate.net&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `ajv-formats` | 3.0.1 | MIT | Copyright (c) 2020 Evgeny Poberezkin | [T1](#t1) | gateway, mcp |
| `ajv` | 8.20.0 | MIT | Copyright (c) 2015-2021 Evgeny Poberezkin | [T5](#t5) | gateway, mcp |
| `ansi-regex` | 5.0.1 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `ansi-regex` | 6.2.2 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting |
| `ansi-regex` | 6.3.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | security-scanning |
| `ansi-regex` | 6.6.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | external-integrations, file-management, global-management, policy-management |
| `ansi-styles` | 4.3.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `ansi-styles` | 5.2.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | dashboard |
| `ansi-styles` | 6.2.3 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `ansis` | 4.3.1 | ISC | Copyright (c) 2026, webdiscus<br>copyright notice and this permission notice appear in all copies. | [T26](#t26) | security-scanning |
| `ansis` | 4.4.0 | ISC | Copyright (c) 2026, webdiscus<br>copyright notice and this permission notice appear in all copies. | [T26](#t26) | analysis-reporting |
| `ansis` | 4.5.0 | ISC | Copyright (c) 2026, webdiscus<br>copyright notice and this permission notice appear in all copies. | [T26](#t26) | external-integrations, file-management, global-management, policy-management |
| `any-promise` | 1.3.0 | MIT | Copyright (C) 2014-2016 Kevin Beaty | [T15](#t15) | dashboard |
| `anymatch` | 3.1.3 | ISC | Copyright (c) 2019 Elan Shanker, Paul Miller (https://paulmillr.com)<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | dashboard |
| `app-root-path` | 3.1.0 | MIT | Copyright (c) 2014 Chris Morrell | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `append-field` | 1.0.0 | MIT | Copyright (c) 2015 Linus Unnebäck | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `archiver-utils` | 5.0.2 | MIT | Copyright (c) 2015 Chris Talkington. | [T15](#t15) | external-integrations, file-management |
| `archiver` | 7.0.1 | MIT | Copyright (c) 2012-2014 Chris Talkington, contributors. | [T15](#t15) | external-integrations, file-management |
| `arg` | 4.1.3 | MIT | Copyright (c) 2017-2019 Zeit, Inc. | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `arg` | 5.0.2 | MIT | Copyright (c) 2021 Vercel, Inc. | [T5](#t5) | dashboard |
| `argparse` | 2.0.1 | Python-2.0 | Copyright (c) 1991 - 1995, Stichting Mathematisch Centrum Amsterdam, | [T29](#t29) | dashboard, gateway, security-scanning |
| `aria-hidden` | 1.2.6 | MIT | Copyright (c) 2017 Anton Korzunov | [T1](#t1) | dashboard |
| `aria-query` | 5.3.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2020 A11yance | [T2](#t2) | dashboard |
| `async` | 3.2.6 | MIT | Copyright (c) 2010-2018 Caolan McMahon | [T15](#t15) | external-integrations, file-management |
| `asynckit` | 0.4.0 | MIT | Copyright (c) 2016 Alex Indigo | [T5](#t5) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `atomic-sleep` | 1.0.0 | MIT | Copyright (c) 2020 David Mark Clements | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `available-typed-arrays` | 1.0.7 | MIT | Copyright (c) 2020 Inspect JS | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `avvio` | 9.3.0 | MIT | Copyright (c) 2016-2020 Matteo Collina<br>Copyright (c) 2020-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `aws-ssl-profiles` | 1.1.2 | MIT | Copyright (c) 2024 Andrey Sidorov, Douglas Wilson, Weslley Araújo and contributors. | [T15](#t15) | analysis-reporting, external-integrations, file-management, global-management, security-scanning |
| `axios` | 1.20.0 | MIT | (author) Matt Zabriskie | [T30](#t30) | analysis-reporting, dashboard, gateway, mcp, security-scanning |
| `axios` | 1.21.1 | MIT | (author) Matt Zabriskie | [T30](#t30) | external-integrations, file-management, global-management, policy-management |
| `b4a` | 1.8.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `b4a` | 1.9.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management |
| `bail` | 2.0.2 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `balanced-match` | 1.0.2 | MIT | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; | [T31](#t31) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `balanced-match` | 4.0.4 | MIT |  | [T32](#t32) | gateway |
| `bare-buffer` | 3.7.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management |
| `bare-events` | 2.8.3 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `bare-events` | 2.9.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management |
| `bare-fs` | 4.7.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `bare-fs` | 4.8.4 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management |
| `bare-os` | 3.9.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `bare-path` | 3.0.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `bare-path` | 3.1.3 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management |
| `bare-stream` | 2.13.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `bare-stream` | 2.13.4 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management |
| `bare-url` | 2.4.3 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | security-scanning |
| `bare-url` | 2.5.7 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management |
| `base64-arraybuffer` | 1.0.2 | MIT | Copyright (c) 2012 Niklas von Hertzen | [T15](#t15) | dashboard |
| `base64-js` | 1.5.1 | MIT | Copyright (c) 2014 Jameson Little | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `before-after-hook` | 4.0.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018 Gregor Martynus and other contributors. | [T2](#t2) | external-integrations |
| `bignumber.js` | 9.3.1 | MIT | Copyright © `&lt;2025&gt;` `Michael Mclaughlin` | [T33](#t33) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `binary-extensions` | 2.3.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com)<br>Copyright (c) Paul Miller (https://paulmillr.com) | [T1](#t1) | dashboard |
| `bluebird` | 3.7.2 | MIT | Copyright (c) 2013-2018 Petka Antonov | [T5](#t5) | file-management |
| `body-parser` | 2.4.0 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `bottleneck` | 2.19.5 | MIT | Copyright (c) 2014 Simon Grondin<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | external-integrations |
| `bowser` | 2.15.0 | MIT | Copyright 2015, Dustin Diaz (the "Original Author") | [T35](#t35) | file-management |
| `brace-expansion` | 2.1.7 | MIT | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; | [T1](#t1) | analysis-reporting, security-scanning |
| `brace-expansion` | 2.1.8 | MIT | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; | [T1](#t1) | external-integrations, file-management, global-management, policy-management |
| `brace-expansion` | 5.0.13 | MIT | Copyright Julian Gruber &lt;julian@juliangruber.com&gt; | [T36](#t36) | gateway |
| `braces` | 3.0.3 | MIT | Copyright (c) 2014-present, Jon Schlinkert. | [T5](#t5) | dashboard |
| `buffer-crc32` | 1.0.0 | MIT | Copyright (c) 2013-2024 Brian J. Brennan | [T19](#t19) | external-integrations, file-management |
| `buffer-equal-constant-time` | 1.0.1 | BSD-3-Clause | Copyright (c) 2013, GoInstant Inc., a salesforce.com company | [T37](#t37) | gateway |
| `buffer-from` | 1.1.2 | MIT | Copyright (c) 2016, 2018 Linus Unnebäck | [T1](#t1) | gateway |
| `buffer` | 6.0.3 | MIT | Copyright (c) Feross Aboukhadijeh, and other contributors. | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `bullmq` | 5.77.7 | MIT | Copyright (c) 2018 BullForce Labs AB and contributors. | [T1](#t1) | analysis-reporting |
| `bullmq` | 5.81.6 | MIT | Copyright (c) 2018 BullForce Labs AB and contributors. | [T1](#t1) | external-integrations, policy-management |
| `busboy` | 1.6.0 | MIT | Copyright Brian White. All rights reserved. | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `bytes` | 3.1.2 | MIT | Copyright (c) 2012-2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;<br>Copyright (c) 2015 Jed Watson &lt;jed.watson@me.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `call-bind-apply-helpers` | 1.0.2 | MIT | Copyright (c) 2024 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `call-bind` | 1.0.9 | MIT | Copyright (c) 2020 Jordan Harband | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `call-bound` | 1.0.4 | MIT | Copyright (c) 2024 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `camelcase-css` | 2.0.1 | MIT | Copyright (c) Steven Vachon &lt;contact@svachon.com&gt; (svachon.com) | [T5](#t5) | dashboard |
| `canvg` | 3.0.11 | MIT | Copyright (c) 2010 - present Gabe Lerner (gabelerner@gmail.com) - https://github.com/canvg/canvg | [T5](#t5) | dashboard |
| `case-anything` | 2.1.13 | MIT | Copyright (c) 2019 Luca Ban - Mesqueeb | [T1](#t1) | file-management |
| `ccount` | 2.0.1 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `chalk` | 4.1.2 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | dashboard |
| `character-entities-html4` | 2.1.0 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `character-entities-legacy` | 3.0.0 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `character-entities` | 2.0.2 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `character-reference-invalid` | 2.0.1 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `chokidar` | 3.6.0 | MIT | Copyright (c) 2012-2019 Paul Miller (https://paulmillr.com), Elan Shanker | [T38](#t38) | dashboard |
| `chromium-bidi` | 16.0.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting |
| `ci-info` | 3.9.0 | MIT | Copyright (c) 2016 Thomas Watson Steen | [T5](#t5) | dashboard |
| `cjs-module-lexer` | 2.2.0 | MIT | Copyright (C) 2018-2020 Guy Bedford | [T39](#t39) | analysis-reporting, gateway, mcp, security-scanning |
| `cjs-module-lexer` | 2.3.0 | MIT | Copyright (C) 2018-2020 Guy Bedford | [T39](#t39) | external-integrations, file-management, global-management, policy-management |
| `class-transformer` | 0.5.1 | MIT | Copyright (c) 2015-2020 TypeStack | [T19](#t19) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `class-validator` | 0.15.1 | MIT | Copyright (c) 2015-2020 TypeStack | [T19](#t19) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2022 Joe Bell | [T40](#t40) | dashboard |
| `cliui` | 8.0.1 | ISC | Copyright (c) 2015, Contributors | [T13](#t13) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `clone-regexp` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `clsx` | 2.1.1 | MIT | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) | [T1](#t1) | dashboard |
| `cluster-key-slot` | 1.1.1 | Apache-2.0 | Copyright (c) 2018 Mike Diarmid (Salakar) &lt;mike.diarmid@gmail.com&gt; | [T41](#t41) | analysis-reporting, external-integrations, gateway, mcp, policy-management, security-scanning |
| `cluster-key-slot` | 1.1.2 | Apache-2.0 | Copyright (c) 2018 Mike Diarmid (Salakar) &lt;mike.diarmid@gmail.com&gt; | [T41](#t41) | analysis-reporting, global-management |
| `cmdk` | 1.1.1 | MIT | Copyright (c) 2022 Paco Coursey | [T1](#t1) | dashboard |
| `color-convert` | 2.0.1 | MIT | Copyright (c) 2011-2016 Heather Arthur &lt;fayearthur@gmail.com&gt; | [T15](#t15) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `color-name` | 1.1.4 | MIT | Copyright (c) 2015 Dmitry Ivanov | [T5](#t5) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `colorette` | 2.0.20 | MIT | Copyright © Jorge Bucaran &lt;&lt;https://jorgebucaran.com&gt;&gt; | [T42](#t42) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `combined-stream` | 1.0.8 | MIT | Copyright (c) 2011 Debuggable Limited &lt;felix@debuggable.com&gt; | [T15](#t15) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `comma-separated-tokens` | 2.0.3 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `commander` | 4.1.1 | MIT | Copyright (c) 2011 TJ Holowaychuk &lt;tj@vision-media.ca&gt; | [T18](#t18) | dashboard |
| `compress-commons` | 6.0.2 | MIT | Copyright (c) 2014 Chris Talkington, contributors. | [T15](#t15) | external-integrations, file-management |
| `content-disposition` | 2.0.1 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `content-disposition` | 3.1.0 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson | [T18](#t18) | gateway |
| `content-type` | 1.0.5 | MIT | Copyright (c) 2015 Douglas Christopher Wilson | [T18](#t18) | mcp |
| `content-type` | 2.1.0 | MIT | Copyright (c) 2015 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `content-type` | 3.1.1 | MIT | Copyright (c) 2015 Douglas Christopher Wilson | [T18](#t18) | external-integrations |
| `convert-hrtime` | 5.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `cookie-signature` | 1.2.2 | MIT | Copyright (c) 2012–2024 LearnBoost &lt;tj@learnboost.com&gt; and other contributors; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `cookie` | 0.7.2 | MIT | Copyright (c) 2012-2014 Roman Shtylman &lt;shtylman@gmail.com&gt;<br>Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `cookie` | 1.1.1 | MIT | Copyright (c) 2012-2014 Roman Shtylman &lt;shtylman@gmail.com&gt;<br>Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | dashboard, gateway, mcp |
| `cookie` | 2.0.2 | MIT | Copyright (c) 2012-2014 Roman Shtylman &lt;shtylman@gmail.com&gt;<br>Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | gateway, mcp |
| `core-js` | 3.50.0 | MIT | Copyright (c) 2013–2025 Denis Pushkarev (zloirock.ru)<br>Copyright (c) 2025–2026 CoreJS Company (core-js.io) | [T15](#t15) | dashboard |
| `core-util-is` | 1.0.3 | MIT | Copyright Node.js contributors. All rights reserved. | [T15](#t15) | external-integrations, file-management, gateway |
| `cors` | 2.8.6 | MIT | Copyright (c) 2013 Troy Goode &lt;troygoode@gmail.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `crc-32` | 1.2.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright (C) 2014-present   SheetJS LLC | [T2](#t2) | external-integrations, file-management |
| `crc32-stream` | 6.0.0 | MIT | Copyright (c) 2014 Chris Talkington, contributors. | [T15](#t15) | external-integrations, file-management |
| `create-require` | 1.1.1 | MIT | Copyright (c) 2020 | [T43](#t43) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `cron-parser` | 4.9.0 | MIT | Copyright (c) 2014-2016 Harri Siirak | [T5](#t5) | analysis-reporting, external-integrations, policy-management |
| `cron` | 4.4.0 | MIT | Copyright © 2017 Nicholas Campbell &lt;nicholas.j.campbell@gmail.com&gt; | [T38](#t38) | analysis-reporting, file-management, security-scanning |
| `cross-spawn` | 7.0.6 | MIT | Copyright (c) 2018 Made With MOXY Lda &lt;hello@moxy.studio&gt; | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, mcp, policy-management, security-scanning |
| `css-line-break` | 2.1.0 | MIT | Copyright (c) 2017 Niklas von Hertzen | [T15](#t15) | dashboard |
| `cssesc` | 3.0.0 | MIT | Copyright Mathias Bynens &lt;https://mathiasbynens.be/&gt; | [T15](#t15) | dashboard |
| `csstype` | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol | [T15](#t15) | dashboard |
| `d3-array` | 3.2.4 | ISC | Copyright 2010-2023 Mike Bostock | [T13](#t13) | dashboard |
| `d3-color` | 3.1.0 | ISC | Copyright 2010-2022 Mike Bostock | [T13](#t13) | dashboard |
| `d3-ease` | 3.0.1 | BSD-3-Clause | Copyright 2010-2021 Mike Bostock<br>Copyright 2001 Robert Penner | [T44](#t44) | dashboard |
| `d3-format` | 3.1.2 | ISC | Copyright 2010-2026 Mike Bostock | [T13](#t13) | dashboard |
| `d3-interpolate` | 3.0.1 | ISC | Copyright 2010-2021 Mike Bostock | [T13](#t13) | dashboard |
| `d3-path` | 3.1.0 | ISC | Copyright 2015-2022 Mike Bostock | [T13](#t13) | dashboard |
| `d3-scale` | 4.0.2 | ISC | Copyright 2010-2021 Mike Bostock | [T13](#t13) | dashboard |
| `d3-shape` | 3.2.0 | ISC | Copyright 2010-2022 Mike Bostock | [T13](#t13) | dashboard |
| `d3-time-format` | 4.1.0 | ISC | Copyright 2010-2021 Mike Bostock | [T13](#t13) | dashboard |
| `d3-time` | 3.1.0 | ISC | Copyright 2010-2022 Mike Bostock | [T13](#t13) | dashboard |
| `d3-timer` | 3.0.1 | ISC | Copyright 2010-2021 Mike Bostock | [T13](#t13) | dashboard |
| `data-uri-to-buffer` | 4.0.1 | MIT | (author) Nathan Rajlich |  | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `date-fns` | 4.4.0 | MIT | Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org | [T1](#t1) | dashboard, global-management |
| `dateformat` | 4.6.3 | MIT | (c) 2007-2009 Steven Levithan &lt;stevenlevithan.com&gt; | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `dayjs` | 1.11.21 | MIT | Copyright (c) 2018-present, iamkun | [T1](#t1) | security-scanning |
| `dayjs` | 1.11.23 | MIT | Copyright (c) 2018-present, iamkun | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management |
| `debug` | 4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk &lt;tj@vision-media.ca&gt;<br>Copyright (c) 2018-2021 Josh Junon | [T18](#t18) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `decimal.js-light` | 2.5.1 | MIT | Copyright (c) 2020 Michael Mclaughlin | [T45](#t45) | dashboard |
| `decode-named-character-reference` | 1.3.0 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `dedent` | 1.7.2 | MIT | (author) Desmond Brand | [T46](#t46) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `define-data-property` | 1.1.4 | MIT | Copyright (c) 2023 Jordan Harband | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `delayed-stream` | 1.0.0 | MIT | Copyright (c) 2011 Debuggable Limited &lt;felix@debuggable.com&gt; | [T15](#t15) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `denque` | 2.1.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2018-present Invertase Limited | [T3](#t3) | analysis-reporting, external-integrations, gateway, global-management, mcp, policy-management, security-scanning |
| `depd` | 2.0.0 | MIT | Copyright (c) 2014-2018 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `dequal` | 2.0.3 | MIT | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) | [T5](#t5) | dashboard, gateway, mcp |
| `detect-libc` | 1.0.3 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright {yyyy} {name of copyright owner} | [T2](#t2) | file-management |
| `detect-libc` | 2.1.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright {yyyy} {name of copyright owner} | [T2](#t2) | analysis-reporting, external-integrations, policy-management |
| `detect-node-es` | 1.1.0 | MIT | Copyright (c) 2017 Ilya Kantor | [T1](#t1) | dashboard |
| `devlop` | 1.1.0 | MIT | Copyright (c) 2023 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `devtools-protocol` | 0.0.1624250 | BSD-3-Clause | (author) The Chromium Authors | [T47](#t47) | analysis-reporting |
| `didyoumean` | 1.2.2 | Apache-2.0 | (author) Dave Porter | [T48](#t48) | dashboard |
| `diff-sequences` | 29.6.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `diff` | 4.0.4 | BSD-3-Clause | Copyright (c) 2009-2015, Kevin Decker &lt;kpdecker@gmail.com&gt;<br>copyright notice, this list of conditions and the<br>copyright notice, this list of conditions and the | [T49](#t49) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `dlv` | 1.1.3 | MIT | (author) Jason Miller |  | dashboard |
| `dom-accessibility-api` | 0.5.16 | MIT | Copyright (c) 2020 Sebastian Silbermann | [T1](#t1) | dashboard |
| `dom-helpers` | 5.2.1 | MIT | Copyright (c) 2015 Jason Quense | [T5](#t5) | dashboard |
| `dompurify` | 3.4.17 | (MPL-2.0 OR Apache-2.0) | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | dashboard |
| `dotenv-expand` | 13.0.0 | BSD-2-Clause | Copyright (c) 2016, Scott Motte | [T50](#t50) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `dotenv` | 16.6.1 | BSD-2-Clause | Copyright (c) 2015, Scott Motte | [T50](#t50) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `dotenv` | 17.4.2 | BSD-2-Clause | Copyright (c) 2015, Scott Motte | [T50](#t50) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `dotenv` | 18.0.3 | BSD-2-Clause | Copyright (c) 2015, Scott Motte | [T50](#t50) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `dprint-node` | 1.0.8 | MIT | Copyright (c) 2021 Devon Govett | [T1](#t1) | file-management |
| `dunder-proto` | 1.0.1 | MIT | Copyright (c) 2024 ECMAScript Shims | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `duplexer2` | 0.1.4 | BSD-3-Clause | Copyright (c) 2013, Deoxxa Development | [T51](#t51) | file-management |
| `duplexify` | 3.7.1 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | gateway |
| `duplexify` | 4.1.3 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | gateway |
| `eastasianwidth` | 0.2.0 | MIT | (author) Masaki Komagata |  | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `ecdsa-sig-formatter` | 1.0.11 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2015 D2L Corporation | [T2](#t2) | gateway |
| `ee-first` | 1.1.1 | MIT | Copyright (c) 2014 Jonathan Ong me@jongleberry.com | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `emoji-regex` | 8.0.0 | MIT | Copyright Mathias Bynens &lt;https://mathiasbynens.be/&gt; | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `emoji-regex` | 9.2.2 | MIT | Copyright Mathias Bynens &lt;https://mathiasbynens.be/&gt; | [T15](#t15) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `encodeurl` | 2.0.0 | MIT | Copyright (c) 2016 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, gateway, mcp, security-scanning |
| `encodeurl` | 2.0.3 | MIT | Copyright (c) 2016 Douglas Christopher Wilson | [T18](#t18) | external-integrations, file-management, global-management, policy-management |
| `end-of-stream` | 1.4.5 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `es-define-property` | 1.0.1 | MIT | Copyright (c) 2024 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `es-errors` | 1.3.0 | MIT | Copyright (c) 2024 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `es-module-lexer` | 3.0.4 | MIT | Copyright (C) 2018-2022 Guy Bedford | [T39](#t39) | external-integrations, file-management, global-management, policy-management |
| `es-object-atoms` | 1.1.1 | MIT | Copyright (c) 2024 Jordan Harband | [T1](#t1) | analysis-reporting |
| `es-object-atoms` | 1.1.2 | MIT | Copyright (c) 2024 Jordan Harband | [T1](#t1) | dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `es-set-tostringtag` | 2.1.0 | MIT | Copyright (c) 2022 ECMAScript Shims | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `es-toolkit` | 1.53.1 | MIT | Copyright (c) 2024 Viva Republica, Inc. | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `escalade` | 3.2.0 | MIT | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `escape-html` | 1.0.3 | MIT | Copyright (c) 2012-2013 TJ Holowaychuk<br>Copyright (c) 2015 Andreas Lubbe<br>Copyright (c) 2015 Tiancheng "Timothy" Gu | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `escape-string-regexp` | 2.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | dashboard |
| `escape-string-regexp` | 5.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `estree-util-is-identifier-name` | 3.0.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `etag` | 1.8.1 | MIT | Copyright (c) 2014-2016 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `event-target-shim` | 5.0.1 | MIT | Copyright (c) 2015 Toru Nagashima | [T5](#t5) | external-integrations, file-management, gateway |
| `eventemitter3` | 4.0.7 | MIT | Copyright (c) 2014 Arnout Kazemier | [T5](#t5) | dashboard |
| `events-universal` | 1.0.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, security-scanning |
| `events` | 3.3.0 | MIT | Copyright Joyent, Inc. and other Node contributors. | [T52](#t52) | external-integrations, file-management, gateway |
| `eventsource-parser` | 3.1.1 | MIT | Copyright (c) 2026 Espen Hovlandsdal &lt;espen@hovlandsdal.com&gt; | [T1](#t1) | mcp |
| `eventsource` | 3.0.7 | MIT | Copyright (c) EventSource GitHub organisation | [T19](#t19) | mcp |
| `expect` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `express-rate-limit` | 8.7.1 | MIT | Copyright 2023 Nathan Friedly, Vedant K | [T1](#t1) | mcp |
| `express` | 5.3.0 | MIT | Copyright (c) 2009-2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;<br>Copyright (c) 2013-2014 Roman Shtylman &lt;shtylman+expressjs@gmail.com&gt;<br>Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `extend` | 3.0.2 | MIT | Copyright (c) 2014 Stefan Thomas | [T5](#t5) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `fast-copy` | 4.1.2 | MIT | Copyright (c) 2025 Tony Quetano | [T1](#t1) | analysis-reporting, gateway, mcp, security-scanning |
| `fast-copy` | 4.3.1 | MIT | Copyright (c) 2025 Tony Quetano | [T1](#t1) | external-integrations, file-management, global-management, policy-management |
| `fast-decode-uri-component` | 1.0.1 | MIT | Copyright (c) 2018 Tomas Della Vedova<br>Copyright (c) 2017 Justin Ridgewell<br>Copyright (c) 2008-2009 Bjoern Hoehrmann &lt;bjoern@hoehrmann.de&gt; | [T1](#t1) | gateway, mcp |
| `fast-deep-equal` | 3.1.3 | MIT | Copyright (c) 2017 Evgeny Poberezkin | [T1](#t1) | gateway, mcp |
| `fast-equals` | 5.4.0 | MIT | Copyright (c) 2025 Tony Quetano | [T1](#t1) | dashboard |
| `fast-fifo` | 1.3.2 | MIT | Copyright (c) 2019 Mathias Buus | [T5](#t5) | external-integrations, file-management, security-scanning |
| `fast-glob` | 3.3.3 | MIT | Copyright (c) Denis Malinochkin | [T5](#t5) | dashboard |
| `fast-json-stringify` | 7.0.1 | MIT | Copyright (c) 2016-present Matteo Collina<br>Copyright (c) 2016-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `fast-png` | 6.4.0 | MIT | Copyright (c) 2015 Michaël Zasso | [T1](#t1) | dashboard |
| `fast-querystring` | 1.1.2 | MIT | Copyright (c) 2022 Yagiz Nizipli | [T15](#t15) | gateway, mcp |
| `fast-safe-stringify` | 2.1.1 | MIT | Copyright (c) 2016 David Mark Clements<br>Copyright (c) 2017 David Mark Clements & Matteo Collina<br>Copyright (c) 2018 David Mark Clements, Matteo Collina & Ruben Bridgewater | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `fast-uri` | 3.1.9 | BSD-3-Clause | Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae<br>Copyright (c) 2021-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T53](#t53) | gateway, mcp |
| `fastify-plugin` | 5.1.0 | MIT | Copyright (c) 2017-present The Fastify team | [T7](#t7) | gateway, mcp |
| `fastify-plugin` | 6.0.1 | MIT | Copyright (c) 2017-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `fastify` | 5.12.8 | MIT | Copyright (c) 2016-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `fastq` | 1.20.1 | ISC | Copyright (c) 2015-2020, Matteo Collina &lt;matteo.collina@gmail.com&gt;<br>copyright notice and this permission notice appear in all copies. | [T54](#t54) | dashboard |
| `fastq` | 1.20.3 | ISC | Copyright (c) 2015-2020, Matteo Collina &lt;matteo.collina@gmail.com&gt;<br>copyright notice and this permission notice appear in all copies. | [T54](#t54) | gateway, mcp |
| `fdir` | 6.5.0 | MIT | Copyright 2023 Abdullah Atta | [T15](#t15) | dashboard |
| `fetch-blob` | 3.2.0 | MIT | Copyright (c) 2019 David Frank | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `fflate` | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett | [T1](#t1) | dashboard |
| `file-type` | 22.3.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `fill-range` | 7.1.1 | MIT | Copyright (c) 2014-present, Jon Schlinkert. | [T5](#t5) | dashboard |
| `finalhandler` | 2.1.1 | MIT | Copyright (c) 2014-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `find-my-way` | 9.10.0 | MIT | Copyright (c) 2017-2019 Tomas Della Vedova | [T1](#t1) | gateway, mcp |
| `find-my-way` | 9.9.0 | MIT | Copyright (c) 2017-2019 Tomas Della Vedova | [T1](#t1) | gateway |
| `follow-redirects` | 1.16.2 | MIT | Copyright 2014–present Olivier Lalonde &lt;olalonde@gmail.com&gt;, James Talmage &lt;james@talmage.io&gt;, Ruben Verborgh | [T15](#t15) | analysis-reporting, dashboard, gateway, mcp, security-scanning |
| `follow-redirects` | 1.16.3 | MIT | Copyright 2014–present Olivier Lalonde &lt;olalonde@gmail.com&gt;, James Talmage &lt;james@talmage.io&gt;, Ruben Verborgh | [T15](#t15) | external-integrations, file-management, global-management, policy-management |
| `for-each` | 0.3.5 | MIT | Copyright (c) 2012 Raynos. | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `foreground-child` | 3.3.1 | ISC | Copyright (c) 2015-2023 Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `form-data` | 4.0.6 | MIT | Copyright (c) 2012 Felix Geisendörfer (felix@debuggable.com) and contributors | [T15](#t15) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `formdata-polyfill` | 4.0.10 | MIT | Copyright (c) 2016 Jimmy Karl Roland Wärting | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `forwarded-parse` | 2.1.2 | MIT | Copyright (c) 2015 Luigi Pinca | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `forwarded` | 0.2.0 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `framer-motion` | 12.38.0 | MIT | Copyright (c) 2018 Framer B.V. | [T5](#t5) | dashboard |
| `fresh` | 2.0.0 | MIT | Copyright (c) 2012 TJ Holowaychuk &lt;tj@vision-media.ca&gt;<br>Copyright (c) 2016-2017 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `fs-extra` | 11.3.1 | MIT | Copyright (c) 2011-2024 JP Richardson | [T18](#t18) | file-management |
| `fsevents` | 2.3.2 | MIT | Copyright (C) 2010-2020 by Philipp Dunkel, Ben Noordhuis, Elan Shankar, Paul Miller | [T39](#t39) | dashboard |
| `fsevents` | 2.3.3 | MIT | Copyright (C) 2010-2020 by Philipp Dunkel, Ben Noordhuis, Elan Shankar, Paul Miller | [T39](#t39) | dashboard |
| `function-bind` | 1.1.2 | MIT | Copyright (c) 2013 Raynos. | [T15](#t15) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `function-timeout` | 0.1.1 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `gaxios` | 7.1.3 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `gaxios` | 7.1.4 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `gcp-metadata` | 8.1.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `gcp-metadata` | 8.1.4 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `generate-function` | 2.3.1 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, security-scanning |
| `get-caller-file` | 2.0.5 | ISC | Copyright 2018 Stefan Penner | [T55](#t55) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `get-intrinsic` | 1.3.0 | MIT | Copyright (c) 2020 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `get-nonce` | 1.0.1 | MIT | Copyright (c) 2020 Anton Korzunov | [T1](#t1) | dashboard |
| `get-proto` | 1.0.1 | MIT | Copyright (c) 2025 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `glob-parent` | 5.1.2 | ISC | Copyright (c) 2015, 2019 Elan Shanker<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | dashboard |
| `glob-parent` | 6.0.2 | ISC | Copyright (c) 2015, 2019 Elan Shanker, 2021 Blaine Bublitz &lt;blaine.bublitz@gmail.com&gt;, Eric Schoffstall &lt;yo@contra.io&gt; and other contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | dashboard |
| `glob` | 10.5.0 | ISC | Copyright (c) 2009-2023 Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `glob` | 14.0.6 | BlueOak-1.0.0 | copyright in it. | [T56](#t56) | gateway |
| `google-logging-utils` | 1.1.3 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `gopd` | 1.2.0 | MIT | Copyright (c) 2022 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `graceful-fs` | 4.2.11 | ISC | Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | dashboard |
| `graceful-fs` | 4.2.12 | BlueOak-1.0.0 | copyright in it. | [T14](#t14) | external-integrations, file-management |
| `handlebars` | 4.7.10 | MIT | Copyright (C) 2011-2019 by Yehuda Katz | [T15](#t15) | global-management |
| `has-flag` | 4.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | dashboard |
| `has-property-descriptors` | 1.0.2 | MIT | Copyright (c) 2022 Inspect JS | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `has-symbols` | 1.1.0 | MIT | Copyright (c) 2016 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `has-tostringtag` | 1.0.2 | MIT | Copyright (c) 2021 Inspect JS | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `hasown` | 2.0.3 | MIT | Copyright (c) Jordan Harband and contributors | [T1](#t1) | analysis-reporting |
| `hasown` | 2.0.4 | MIT | Copyright (c) Jordan Harband and contributors | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `hast-util-to-jsx-runtime` | 2.3.6 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `hast-util-whitespace` | 3.0.0 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `help-me` | 5.0.0 | MIT | Copyright (c) 2014-2022 Matteo Collina | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `hono` | 4.13.18 | MIT | Copyright (c) 2021 - present, Yusuke Wada and Hono contributors | [T1](#t1) | mcp |
| `hpagent` | 1.2.0 | MIT | Copyright (c) 2020 Tomas Della Vedova | [T1](#t1) | security-scanning |
| `html-parse-stringify` | 3.0.1 | MIT | (author) Henrik Joreteg |  | dashboard |
| `html-to-image` | 1.11.13 | MIT | Copyright (c) 2017-2025 W.Y. | [T1](#t1) | dashboard |
| `html-url-attributes` | 3.0.1 | MIT | Copyright (c) Titus Wormer | [T57](#t57) | dashboard |
| `html2canvas` | 1.4.1 | MIT | Copyright (c) 2012 Niklas von Hertzen | [T15](#t15) | dashboard |
| `http-errors` | 2.0.1 | MIT | Copyright (c) 2014 Jonathan Ong me@jongleberry.com<br>Copyright (c) 2016 Douglas Christopher Wilson doug@somethingdoug.com | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `https-proxy-agent` | 5.0.1 | MIT | (author) Nathan Rajlich |  | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `https-proxy-agent` | 7.0.6 | MIT | Copyright (c) 2013 Nathan Rajlich &lt;nathan@tootallnate.net&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `i18next` | 26.3.4 | MIT | Copyright (c) 2011-present i18next | [T5](#t5) | dashboard |
| `iconv-lite` | 0.7.3 | MIT | Copyright (c) 2011 Alexander Shtuchkin | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `ieee754` | 1.2.1 | BSD-3-Clause | Copyright 2008 Fair Oaks Labs, Inc. | [T58](#t58) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `immer` | 11.1.4 | MIT | Copyright (c) 2017 Michel Weststrate | [T1](#t1) | dashboard |
| `import-in-the-middle` | 3.0.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, gateway, mcp, security-scanning |
| `import-in-the-middle` | 3.6.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, global-management, policy-management |
| `inherits` | 2.0.4 | ISC | Copyright (c) Isaac Z. Schlueter<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `inline-style-parser` | 0.2.7 | MIT | Copyright (c) 2012 TJ Holowaychuk &lt;tj@vision-media.ca&gt; | [T18](#t18) | dashboard |
| `internmap` | 2.0.3 | ISC | Copyright 2021 Mike Bostock | [T13](#t13) | dashboard |
| `iobuffer` | 5.4.0 | MIT | Copyright (c) 2015 Michaël Zasso | [T5](#t5) | dashboard |
| `ioredis` | 5.10.1 | MIT | Copyright (c) 2015-2022 Zihua Li | [T5](#t5) | analysis-reporting, global-management |
| `ioredis` | 5.11.0 | MIT | Copyright (c) 2015-2022 Zihua Li | [T5](#t5) | analysis-reporting |
| `ioredis` | 5.11.1 | MIT | Copyright (c) 2015-2022 Zihua Li | [T5](#t5) | external-integrations, gateway, mcp, policy-management, security-scanning |
| `ip-address` | 10.7.5 | MIT | Copyright (C) 2011 by Beau Gunderson | [T15](#t15) | mcp, security-scanning |
| `ip-regex` | 5.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `ipaddr.js` | 1.9.1 | MIT | Copyright (C) 2011-2017 whitequark &lt;whitequark@whitequark.org&gt; | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `ipaddr.js` | 2.5.0 | MIT | Copyright (C) 2011-2017 whitequark &lt;whitequark@whitequark.org&gt; | [T15](#t15) | gateway, mcp |
| `is-alphabetical` | 2.0.1 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `is-alphanumerical` | 2.0.1 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `is-binary-path` | 2.1.0 | MIT | Copyright (c) 2019 Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com), Paul Miller (https://paulmillr.com) | [T1](#t1) | dashboard |
| `is-callable` | 1.2.7 | MIT | Copyright (c) 2015 Jordan Harband | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `is-core-module` | 2.16.1 | MIT | Copyright (c) 2014 Dave Justice<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `is-decimal` | 2.0.1 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `is-extglob` | 2.1.1 | MIT | Copyright (c) 2014-2016, Jon Schlinkert | [T5](#t5) | dashboard |
| `is-fullwidth-code-point` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `is-glob` | 4.0.3 | MIT | Copyright (c) 2014-2017, Jon Schlinkert. | [T5](#t5) | dashboard |
| `is-hexadecimal` | 2.0.1 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `is-ip` | 5.0.1 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `is-number` | 7.0.0 | MIT | Copyright (c) 2014-present, Jon Schlinkert. | [T5](#t5) | dashboard |
| `is-plain-obj` | 4.1.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `is-promise` | 4.0.0 | MIT | Copyright (c) 2014 Forbes Lindesay | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `is-property` | 1.0.2 | MIT | Copyright (c) 2013 Mikola Lysenko | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, security-scanning |
| `is-regexp` | 3.1.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `is-stream` | 2.0.1 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | external-integrations, file-management |
| `is-typed-array` | 1.1.15 | MIT | Copyright (c) 2015 Jordan Harband | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `isarray` | 1.0.0 | MIT | (author) Julian Gruber |  | external-integrations, file-management, gateway |
| `isarray` | 2.0.5 | MIT | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `isexe` | 2.0.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting, external-integrations, file-management, global-management, mcp, policy-management, security-scanning |
| `isomorphic-ws` | 5.0.0 | MIT | Copyright (c) 2018 Zejin Zhuang &lt;heineiuo@gmail.com&gt; | [T5](#t5) | security-scanning |
| `iterare` | 1.2.1 | ISC | Copyright (c) 2016, Felix Frederick Becker<br>copyright notice and this permission notice appear in all copies. | [T26](#t26) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `jackspeak` | 3.4.3 | BlueOak-1.0.0 | copyright in it. | [T59](#t59) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `jest-diff` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `jest-get-type` | 29.6.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `jest-matcher-utils` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `jest-message-util` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `jest-util` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `jiti` | 1.21.7 | MIT | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; | [T1](#t1) | dashboard |
| `joi` | 18.3.1 | BSD-3-Clause | Copyright (c) 2012-2022, Project contributors.<br>Copyright (c) 2012-2022, Sideway. Inc.<br>Copyright (c) 2012-2014, Walmart. | [T11](#t11) | analysis-reporting |
| `joi` | 18.3.2 | BSD-3-Clause | Copyright (c) 2012-2022, Project contributors.<br>Copyright (c) 2012-2022, Sideway. Inc.<br>Copyright (c) 2012-2014, Walmart. | [T11](#t11) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `jose` | 6.2.18 | MIT | Copyright (c) 2018 Filip Skokan | [T5](#t5) | gateway, mcp |
| `jose` | 6.2.3 | MIT | Copyright (c) 2018 Filip Skokan | [T5](#t5) | security-scanning |
| `joycon` | 3.1.1 | MIT | Copyright (c) egoist &lt;0x142857@gmail.com&gt; (https://github.com/egoist) | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `js-tokens` | 4.0.0 | MIT | Copyright (c) 2014, 2015, 2016, 2017, 2018 Simon Lydell | [T5](#t5) | dashboard |
| `js-yaml` | 4.3.2 | MIT | Copyright (C) 2011-2015 by Vitaly Puzrin | [T57](#t57) | security-scanning |
| `js-yaml` | 5.4.3 | MIT | Copyright (C) 2011-2015 by Vitaly Puzrin | [T57](#t57) | dashboard, gateway |
| `jsep` | 1.4.0 | MIT | Copyright (c) 2013 Stephen Oney, https://ericsmekens.github.io/jsep/ | [T15](#t15) | security-scanning |
| `json-bigint` | 1.0.0 | MIT | Copyright (c) 2013 Andrey Sidorov<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `json-schema-ref-resolver` | 3.0.0 | MIT | Copyright (c) 2023 Fastify | [T1](#t1) | gateway, mcp |
| `json-schema-traverse` | 1.0.0 | MIT | Copyright (c) 2017 Evgeny Poberezkin | [T1](#t1) | gateway, mcp |
| `json-schema-typed` | 8.0.2 | BSD-2-Clause | (author) Remy Rylan | [T60](#t60) | mcp |
| `json-with-bigint` | 3.5.12 | MIT | Copyright (c) 2023 Ivan Korolenko | [T1](#t1) | external-integrations |
| `jsonfile` | 6.2.1 | MIT | Copyright (c) 2012-2015, JP Richardson &lt;jprichardson@gmail.com&gt; | [T18](#t18) | file-management |
| `jsonpath-plus` | 10.4.0 | MIT | Copyright (c) 2011-2019 Stefan Goessner, Subbu Allamaraju, Mike Brevoort, | [T61](#t61) | security-scanning |
| `jsonwebtoken` | 9.0.3 | MIT | Copyright (c) 2015 Auth0, Inc. &lt;support@auth0.com&gt; (http://auth0.com) | [T5](#t5) | gateway |
| `jspdf` | 4.2.1 | MIT | Copyright<br>(c) 2010-2025 James Hall, https://github.com/MrRio/jsPDF<br>(c) 2015-2025 yWorks GmbH, https://www.yworks.com/ | [T15](#t15) | dashboard |
| `jwa` | 2.0.1 | MIT | Copyright (c) 2013 Brian J. Brennan | [T15](#t15) | gateway |
| `jws` | 4.0.1 | MIT | Copyright (c) 2013 Brian J. Brennan | [T15](#t15) | gateway |
| `lazystream` | 1.0.1 | MIT | Copyright (c) 2013 J. Pommerening, contributors. | [T15](#t15) | external-integrations, file-management |
| `libphonenumber-js` | 1.12.42 | MIT | Copyright (c) 2016 @catamphetamine &lt;purecatamphetamine@gmail.com&gt; | [T18](#t18) | analysis-reporting, gateway, mcp |
| `libphonenumber-js` | 1.13.16 | MIT | Copyright (c) 2016 @catamphetamine &lt;purecatamphetamine@gmail.com&gt; | [T18](#t18) | external-integrations, file-management, global-management, policy-management |
| `libphonenumber-js` | 1.13.4 | MIT | Copyright (c) 2016 @catamphetamine &lt;purecatamphetamine@gmail.com&gt; | [T18](#t18) | security-scanning |
| `light-my-request` | 6.6.0 | BSD-3-Clause | Copyright (c) 2017 The Fastify Team<br>Copyright (c) 2012-2017, Project contributors<br>Copyright (c) 2012-2014, Walmart | [T62](#t62) | gateway, mcp |
| `light-my-request` | 6.8.0 | BSD-3-Clause | Copyright (c) 2012-2014, Walmart<br>Copyright (c) 2012-2017, Project contributors<br>Copyright (c) 2017-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T62](#t62) | gateway, mcp |
| `lilconfig` | 3.1.3 | MIT | Copyright (c) 2022 Anton Kastritskiy | [T1](#t1) | analysis-reporting, dashboard |
| `lines-and-columns` | 1.2.4 | MIT | Copyright (c) 2015 Brian Donovan | [T5](#t5) | dashboard |
| `load-esm` | 1.0.3 | MIT | Copyright © 2025 Borewit | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `lodash.camelcase` | 4.3.0 | MIT | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt;<br>Copyright and related rights for sample code are waived via CC0. Sample | [T63](#t63) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `lodash.defaults` | 4.2.0 | MIT | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt;<br>Copyright and related rights for sample code are waived via CC0. Sample | [T63](#t63) | analysis-reporting, global-management |
| `lodash.includes` | 4.3.0 | MIT | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt;<br>Copyright and related rights for sample code are waived via CC0. Sample | [T63](#t63) | gateway |
| `lodash.isarguments` | 3.1.0 | MIT | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt;<br>Copyright and related rights for sample code are waived via CC0. Sample | [T63](#t63) | analysis-reporting, global-management |
| `lodash.isboolean` | 3.0.3 | MIT | Copyright 2012-2016 The Dojo Foundation &lt;http://dojofoundation.org/&gt; | [T64](#t64) | gateway |
| `lodash.isinteger` | 4.0.4 | MIT | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt;<br>Copyright and related rights for sample code are waived via CC0. Sample | [T63](#t63) | gateway |
| `lodash.isnumber` | 3.0.3 | MIT | Copyright 2012-2016 The Dojo Foundation &lt;http://dojofoundation.org/&gt; | [T64](#t64) | gateway |
| `lodash.isplainobject` | 4.0.6 | MIT | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt;<br>Copyright and related rights for sample code are waived via CC0. Sample | [T63](#t63) | gateway |
| `lodash.isstring` | 4.0.1 | MIT | Copyright 2012-2016 The Dojo Foundation &lt;http://dojofoundation.org/&gt; | [T64](#t64) | gateway |
| `lodash.once` | 4.1.1 | MIT | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt;<br>Copyright and related rights for sample code are waived via CC0. Sample | [T63](#t63) | gateway |
| `lodash` | 4.18.1 | MIT | Copyright OpenJS Foundation and other contributors &lt;https://openjsf.org/&gt;<br>Copyright and related rights for sample code are waived via CC0. Sample | [T63](#t63) | dashboard, external-integrations, file-management |
| `long` | 5.3.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `longest-streak` | 3.1.0 | MIT | Copyright (c) 2015 Titus Wormer &lt;mailto:tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `loose-envify` | 1.4.0 | MIT | Copyright (c) 2015 Andres Suarez &lt;zertosh@gmail.com&gt; | [T5](#t5) | dashboard |
| `lru-cache` | 10.4.3 | ISC | Copyright (c) 2010-2023 Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `lru-cache` | 11.5.3 | BlueOak-1.0.0 | copyright in it. | [T14](#t14) | gateway |
| `lru.min` | 1.1.4 | MIT | Copyright (c) 2024-current Weslley Araújo (@wellwelwel) | [T1](#t1) | analysis-reporting |
| `lru.min` | 1.1.5 | MIT | Copyright (c) 2024-current Weslley Araújo (@wellwelwel) | [T1](#t1) | external-integrations, file-management, global-management, security-scanning |
| `lucide-react` | 0.487.0 | ISC | Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.<br>copyright notice and this permission notice appear in all copies. | [T26](#t26) | dashboard |
| `luxon` | 3.7.2 | MIT | Copyright 2019 JS Foundation and other contributors | [T15](#t15) | analysis-reporting, external-integrations, file-management, policy-management, security-scanning |
| `lz-string` | 1.5.0 | MIT | Copyright (c) 2013 pieroxy | [T1](#t1) | dashboard |
| `make-error` | 1.3.6 | ISC | Copyright 2014 Julien Fontanet | [T13](#t13) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `markdown-table` | 3.0.4 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `math-intrinsics` | 1.1.0 | MIT | Copyright (c) 2024 ECMAScript Shims | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `mdast-util-find-and-replace` | 3.0.2 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-from-markdown` | 2.0.3 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-gfm-autolink-literal` | 2.0.1 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-gfm-footnote` | 2.1.0 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-gfm-strikethrough` | 2.0.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-gfm-table` | 2.0.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-gfm-task-list-item` | 2.0.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-gfm` | 3.1.0 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-mdx-expression` | 2.0.1 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-mdx-jsx` | 3.2.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-mdxjs-esm` | 2.0.1 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-phrasing` | 4.1.0 | MIT | Copyright (c) 2017 Titus Wormer &lt;tituswormer@gmail.com&gt;<br>Copyright (c) 2017 Victor Felder &lt;victor@draft.li&gt; | [T18](#t18) | dashboard |
| `mdast-util-to-hast` | 13.2.1 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-to-markdown` | 2.1.2 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `mdast-util-to-string` | 4.0.0 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `media-typer` | 0.3.0 | MIT | Copyright (c) 2014 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `media-typer` | 1.1.0 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting |
| `media-typer` | 1.1.1 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson | [T18](#t18) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `merge-descriptors` | 2.0.0 | MIT | Copyright (c) Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt;<br>Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `merge2` | 1.4.1 | MIT | Copyright (c) 2014-2020 Teambition | [T5](#t5) | dashboard |
| `micromark-core-commonmark` | 2.0.3 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-extension-gfm-autolink-literal` | 2.1.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-extension-gfm-footnote` | 2.1.0 | MIT | Copyright (c) 2021 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-extension-gfm-strikethrough` | 2.1.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-extension-gfm-table` | 2.1.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-extension-gfm-tagfilter` | 2.0.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-extension-gfm-task-list-item` | 2.1.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-extension-gfm` | 3.0.0 | MIT | Copyright (c) 2020 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-factory-destination` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-factory-label` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-factory-space` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-factory-title` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-factory-whitespace` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-character` | 2.1.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-chunked` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-classify-character` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-combine-extensions` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-decode-numeric-character-reference` | 2.0.2 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-decode-string` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-encode` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-html-tag-name` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-normalize-identifier` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-resolve-all` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-sanitize-uri` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-subtokenize` | 2.1.0 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-symbol` | 2.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark-util-types` | 2.0.2 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromark` | 4.0.2 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `micromatch` | 4.0.8 | MIT | Copyright (c) 2014-present, Jon Schlinkert. | [T5](#t5) | dashboard |
| `mime-db` | 1.52.0 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2015-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `mime-db` | 1.54.0 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2015-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `mime-types` | 2.1.35 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `mime-types` | 3.0.2 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `mime` | 3.0.0 | MIT | Copyright (c) 2010 Benjamin Thomas, Robert Kieffer | [T5](#t5) | gateway |
| `mini-svg-data-uri` | 1.4.4 | MIT | Copyright (c) 2018 Taylor Hunt | [T1](#t1) | dashboard |
| `minimatch` | 11.0.9 | BlueOak-1.0.0 | copyright in it. | [T59](#t59) | gateway |
| `minimatch` | 5.1.9 | ISC | Copyright (c) 2011-2023 Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | external-integrations, file-management |
| `minimatch` | 9.0.9 | ISC | Copyright (c) 2011-2023 Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `minimist` | 1.2.8 | MIT | COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T65](#t65) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | copyright in it. | [T14](#t14) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `mitt` | 3.0.1 | MIT | Copyright (c) 2021 Jason Miller | [T1](#t1) | analysis-reporting |
| `modern-tar` | 0.7.6 | MIT | Copyright (c) 2025 Ayuhito | [T1](#t1) | analysis-reporting |
| `module-details-from-path` | 1.0.4 | MIT | Copyright (c) 2016-2025 Thomas Watson Steen | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `motion-dom` | 12.38.0 | MIT | Copyright (c) 2024 [Motion](https://motion.dev) B.V. | [T5](#t5) | dashboard |
| `motion-utils` | 12.36.0 | MIT | Copyright (c) 2024 [Motion](https://motion.dev) B.V. | [T5](#t5) | dashboard |
| `ms` | 2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. | [T5](#t5) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `msgpackr-extract` | 3.0.4 | MIT | Copyright (c) 2020 Kris Zyp | [T1](#t1) | analysis-reporting |
| `msgpackr-extract` | 3.0.7 | MIT | Copyright (c) 2020 Kris Zyp | [T1](#t1) | external-integrations, policy-management |
| `msgpackr` | 2.0.2 | MIT | Copyright (c) 2020 Kris Zyp | [T1](#t1) | analysis-reporting |
| `msgpackr` | 2.0.5 | MIT | Copyright (c) 2020 Kris Zyp | [T1](#t1) | external-integrations, policy-management |
| `multer` | 2.5.0 | MIT | Copyright (c) 2014 Hage Yaapa &lt;[http://www.hacksparrow.com](http://www.hacksparrow.com)&gt; | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `mysql2` | 3.24.4 | MIT | Copyright (c) 2016 Andrey Sidorov (sidorares@yandex.ru) and contributors | [T15](#t15) | analysis-reporting |
| `mysql2` | 3.24.6 | MIT | Copyright (c) 2016 Andrey Sidorov (sidorares@yandex.ru) and contributors | [T15](#t15) | external-integrations, file-management, global-management, security-scanning |
| `mz` | 2.7.0 | MIT | Copyright (c) 2014-2016 Jonathan Ong me@jongleberry.com and Contributors | [T5](#t5) | dashboard |
| `named-placeholders` | 1.1.6 | MIT | Copyright (c) 2014 Andrey Sidorov | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, security-scanning |
| `nanoid` | 3.3.20 | MIT | Copyright 2017 Andrey Sitnik &lt;andrey@sitnik.ru&gt;<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `negotiator` | 1.0.0 | MIT | Copyright (c) 2012-2014 Federico Romero<br>Copyright (c) 2012-2014 Isaac Z. Schlueter<br>Copyright (c) 2014-2015 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting |
| `negotiator` | 1.1.0 | MIT | Copyright (c) 2012-2014 Federico Romero<br>Copyright (c) 2012-2014 Isaac Z. Schlueter<br>Copyright (c) 2014-2015 Douglas Christopher Wilson | [T18](#t18) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `neo-async` | 2.6.2 | MIT | Copyright (c) 2014-2018 Suguru Motegi | [T66](#t66) | global-management |
| `nestjs-otel` | 8.1.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works | [T67](#t67) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `nestjs-pino` | 5.3.1 | MIT | Copyright (c) 2019 iamolegga | [T1](#t1) | analysis-reporting |
| `nestjs-pino` | 5.3.2 | MIT | Copyright (c) 2019 iamolegga | [T1](#t1) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `nice-grpc-common` | 2.0.3 | MIT | Copyright (c) 2021 Deeplay<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | gateway |
| `nice-grpc-common` | 2.0.4 | MIT | Copyright (c) 2021 Deeplay<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | global-management |
| `nice-grpc` | 2.1.16 | MIT | Copyright (c) 2021 Deeplay<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | gateway |
| `nice-grpc` | 2.1.18 | MIT | Copyright (c) 2021 Deeplay<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | global-management |
| `node-abort-controller` | 3.1.1 | MIT | Copyright (c) 2019 Steve Faulkner | [T1](#t1) | analysis-reporting, external-integrations, policy-management |
| `node-domexception` | 1.0.0 | MIT | Copyright (c) 2021 Jimmy Wärting | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `node-fetch` | 2.7.0 | MIT | Copyright (c) 2016 David Frank | [T5](#t5) | security-scanning |
| `node-fetch` | 3.3.2 | MIT | Copyright (c) 2016 - 2020 Node Fetch Team | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `node-gyp-build-optional-packages` | 5.2.2 | MIT | Copyright (c) 2017 Mathias Buus | [T5](#t5) | analysis-reporting, external-integrations, policy-management |
| `node-int64` | 0.4.0 | MIT | Copyright (c) 2014 Robert Kieffer | [T15](#t15) | file-management |
| `nodemailer` | 10.5.0 | MIT-0 | Copyright (c) 2011-2023 Andris Reinman | [T68](#t68) | global-management |
| `normalize-path` | 3.0.0 | MIT | Copyright (c) 2014-2018, Jon Schlinkert. | [T5](#t5) | dashboard, external-integrations, file-management |
| `oauth4webapi` | 3.8.6 | MIT | Copyright (c) 2022 Filip Skokan | [T5](#t5) | security-scanning |
| `object-assign` | 4.1.1 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T5](#t5) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `object-hash` | 3.0.0 | MIT | Copyright (c) 2014 object-hash contributors | [T5](#t5) | dashboard |
| `object-inspect` | 1.13.4 | MIT | Copyright (c) 2013 James Halliday | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `on-exit-leak-free` | 2.1.2 | MIT | Copyright (c) 2021 Matteo Collina | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `on-finished` | 2.4.1 | MIT | Copyright (c) 2013 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2014 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, mcp |
| `on-finished` | 2.4.2 | MIT | Copyright (c) 2013 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2014 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `once` | 1.4.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `openid-client` | 6.8.4 | MIT | Copyright (c) 2016 Filip Skokan | [T5](#t5) | security-scanning |
| `otlp-logger` | 2.0.0 | MIT | Copyright (c) 2023 Vladimir Adamić | [T1](#t1) | analysis-reporting, gateway, mcp |
| `otlp-logger` | 2.1.0 | MIT | Copyright (c) 2023 Vladimir Adamić | [T1](#t1) | security-scanning |
| `otlp-logger` | 2.1.1 | MIT | Copyright (c) 2023 Vladimir Adamić | [T1](#t1) | external-integrations, file-management, global-management, policy-management |
| `package-json-from-dist` | 1.0.1 | BlueOak-1.0.0 | copyright in it. | [T56](#t56) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `pako` | 2.1.0 | (MIT AND Zlib) | Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn | [T57](#t57) | dashboard |
| `parse-entities` | 4.0.2 | MIT | Copyright (c) Titus Wormer &lt;mailto:tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `parseurl` | 1.3.3 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2014-2017 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `path-key` | 3.1.1 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, mcp, policy-management, security-scanning |
| `path-parse` | 1.0.7 | MIT | Copyright (c) 2015 Javier Blanco | [T5](#t5) | dashboard |
| `path-scurry` | 1.11.1 | BlueOak-1.0.0 | copyright in it. | [T14](#t14) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `path-scurry` | 3.0.0 | BlueOak-1.0.0 | copyright in it. | [T14](#t14) | gateway |
| `path-to-regexp` | 8.4.2 | MIT | Copyright (c) 2014 Blake Embrey (hello@blakeembrey.com) | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `peek-stream` | 1.1.3 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | gateway |
| `pend` | 1.2.0 | MIT | Copyright (c) 2014 Andrew Kelley | [T69](#t69) | external-integrations, file-management |
| `performance-now` | 2.1.0 | MIT | Copyright (c) 2013 Braveg1rl | [T15](#t15) | dashboard |
| `pg-cloudflare` | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `pg-connection-string` | 2.14.1 | MIT | Copyright (c) 2014 Iced Development | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `pg-int8` | 1.0.1 | ISC | Copyright © 2017, Charmander &lt;~@charmander.me&gt;<br>copyright notice and this permission notice appear in all copies. | [T70](#t70) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pg-pool` | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `pg-protocol` | 1.13.0 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | [T1](#t1) | analysis-reporting, gateway, mcp |
| `pg-protocol` | 1.14.0 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | [T1](#t1) | security-scanning |
| `pg-protocol` | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `pg-types` | 2.2.0 | MIT | (author) Brian M. Carlson |  | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pg` | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `pgpass` | 1.0.5 | MIT | (author) Hannes Hörl |  | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `picocolors` | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov<br>copyright notice and this permission notice appear in all copies. | [T26](#t26) | dashboard |
| `picomatch` | 2.3.2 | MIT | Copyright (c) 2017-present, Jon Schlinkert. | [T5](#t5) | dashboard |
| `picomatch` | 4.0.7 | MIT | Copyright (c) 2017-present, Jon Schlinkert. | [T5](#t5) | dashboard, policy-management |
| `pify` | 2.3.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T5](#t5) | dashboard |
| `pino-abstract-transport` | 3.0.0 | MIT | Copyright (c) 2021 pino | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pino-http` | 11.0.0 | MIT | Copyright (c) 2024 Matteo Collina<br>Copyright (c) 2024 David Mark Clements | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pino-opentelemetry-transport` | 3.0.0 | MIT | Copyright (c) 2022 Vladimir Adamić | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pino-pretty` | 13.1.3 | MIT | Copyright (c) 2019 the Pino team listed at https://github.com/pinojs/pino#the-team | [T5](#t5) | analysis-reporting, gateway, mcp, security-scanning |
| `pino-pretty` | 13.2.0 | MIT | Copyright (c) 2019 the Pino team listed at https://github.com/pinojs/pino#the-team | [T5](#t5) | external-integrations, file-management, global-management, policy-management |
| `pino-std-serializers` | 7.1.0 | MIT | Copyright Mateo Collina, David Mark Clements, James Sumners | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pino` | 10.4.0 | MIT | Copyright (c) 2016-present Matteo Collina, David Mark Clements and the Pino contributors listed at &lt;https://github.com/pinojs/pino#the-team&gt; and in the README file. | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pirates` | 4.0.7 | MIT | Copyright (c) 2016-2018 Ari Porad | [T1](#t1) | dashboard |
| `pkce-challenge` | 5.0.1 | MIT | Copyright (c) 2019 | [T1](#t1) | mcp |
| `playwright-core` | 1.59.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works | [T22](#t22) | dashboard |
| `playwright` | 1.59.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works | [T22](#t22) | dashboard |
| `possible-typed-array-names` | 1.1.0 | MIT | Copyright (c) 2024 Jordan Harband | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `postcss-import` | 15.1.0 | MIT | Copyright (c) 2014 Maxime Thirouin, Jason Campbell & Kevin Mårtensson<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `postcss-js` | 4.1.0 | MIT | Copyright 2015 Andrey Sitnik &lt;andrey@sitnik.ru&gt;<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `postcss-load-config` | 6.0.1 | MIT | Copyright Michael Ciniawsky &lt;michael.ciniawsky@gmail.com&gt;<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `postcss-nested` | 6.2.0 | MIT | Copyright 2014 Andrey Sitnik &lt;andrey@sitnik.ru&gt;<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `postcss-selector-parser` | 6.1.5 | MIT | Copyright (c) Ben Briggs &lt;beneb.info@gmail.com&gt; (http://beneb.info) | [T15](#t15) | dashboard |
| `postcss-value-parser` | 4.2.0 | MIT | Copyright (c) Bogdan Chadkin &lt;trysound@yandex.ru&gt; | [T15](#t15) | dashboard |
| `postcss` | 8.5.33 | MIT | Copyright 2013 Andrey Sitnik &lt;andrey@sitnik.es&gt;<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `postgres-array` | 2.0.0 | MIT | Copyright (c) Ben Drucker &lt;bvdrucker@gmail.com&gt; (bendrucker.me) | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `postgres-bytea` | 1.0.1 | MIT | Copyright (c) Ben Drucker &lt;bvdrucker@gmail.com&gt; (bendrucker.me) | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `postgres-date` | 1.0.7 | MIT | Copyright (c) Ben Drucker &lt;bvdrucker@gmail.com&gt; (bendrucker.me) | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `postgres-interval` | 1.2.0 | MIT | Copyright (c) Ben Drucker &lt;bvdrucker@gmail.com&gt; (bendrucker.me) | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pretty-format` | 27.5.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. | [T1](#t1) | dashboard |
| `pretty-format` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `prism-react-renderer` | 2.4.1 | MIT | Copyright (c) 2018 Nearform | [T1](#t1) | dashboard |
| `process-nextick-args` | 2.0.1 | MIT |  | [T71](#t71) | external-integrations, file-management, gateway |
| `process-warning` | 4.0.1 | MIT | Copyright (c) Fastify | [T1](#t1) | gateway, mcp |
| `process-warning` | 5.1.0 | MIT | Copyright (c) 2020-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | analysis-reporting, gateway |
| `process-warning` | 5.1.1 | MIT | Copyright (c) 2020-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | external-integrations, file-management, global-management, mcp, policy-management, security-scanning |
| `process` | 0.11.10 | MIT | Copyright (c) 2013 Roman Shtylman &lt;shtylman@gmail.com&gt; | [T18](#t18) | external-integrations, file-management, gateway |
| `prop-types` | 15.8.1 | MIT | Copyright (c) 2013-present, Facebook, Inc. | [T1](#t1) | dashboard |
| `property-information` | 7.1.0 | MIT | Copyright (c) Titus Wormer &lt;mailto:tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `protobufjs` | 7.6.6 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T72](#t72) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `protobufjs` | 8.8.0 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz  All rights reserved. | [T72](#t72) | analysis-reporting, gateway, mcp, security-scanning |
| `proxy-addr` | 2.0.8 | MIT | Copyright (c) 2014-2016 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `proxy-from-env` | 2.1.0 | MIT | Copyright (C) 2016-2018 Rob Wu &lt;rob@robwu.nl&gt;<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T73](#t73) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pump` | 3.0.4 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `pumpify` | 2.0.1 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | gateway |
| `puppeteer-core` | 25.1.0 | Apache-2.0 | (author) The Chromium Authors |  | analysis-reporting |
| `puppeteer` | 25.1.0 | Apache-2.0 | (author) The Chromium Authors |  | analysis-reporting |
| `qs` | 6.16.1 | BSD-3-Clause | Copyright (c) 2014, Nathan LaFreniere and other [contributors](https://github.com/ljharb/qs/graphs/contributors) | [T74](#t74) | analysis-reporting, gateway, mcp, security-scanning |
| `qs` | 6.17.1 | BSD-3-Clause | Copyright (c) 2014, Nathan LaFreniere and other [contributors](https://github.com/ljharb/qs/graphs/contributors) | [T74](#t74) | dashboard, external-integrations, file-management, global-management, policy-management |
| `queue-microtask` | 1.2.3 | MIT | Copyright (c) Feross Aboukhadijeh<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `quick-format-unescaped` | 4.0.4 | MIT | Copyright (c) 2016-2019 David Mark Clements | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `raf` | 3.4.1 | MIT | Copyright 2013 Chris Dickinson &lt;chris@neversaw.us&gt; | [T15](#t15) | dashboard |
| `range-parser` | 1.2.1 | MIT | Copyright (c) 2012-2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;<br>Copyright (c) 2015-2016 Douglas Christopher Wilson &lt;doug@somethingdoug.com | [T18](#t18) | analysis-reporting |
| `range-parser` | 1.3.0 | MIT | Copyright (c) 2012-2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;<br>Copyright (c) 2015-2016 Douglas Christopher Wilson &lt;doug@somethingdoug.com | [T18](#t18) | external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `raw-body` | 3.0.2 | MIT | Copyright (c) 2013-2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2014-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `react-dom` | 18.3.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. | [T1](#t1) | dashboard |
| `react-i18next` | 15.7.4 | MIT | Copyright (c) 2025 i18next | [T5](#t5) | dashboard |
| `react-icons` | 5.6.0 | MIT | Copyright 2018 kamijin_fanta &lt;kamijin@live.jp&gt; | [T75](#t75) | dashboard |
| `react-is` | 16.13.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. | [T1](#t1) | dashboard |
| `react-is` | 17.0.2 | MIT | Copyright (c) Facebook, Inc. and its affiliates. | [T1](#t1) | dashboard |
| `react-is` | 18.3.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. | [T1](#t1) | dashboard |
| `react-markdown` | 10.1.0 | MIT | Copyright (c) Espen Hovlandsdal | [T5](#t5) | dashboard |
| `react-rebac` | 1.0.5 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | dashboard |
| `react-redux` | 9.2.0 | MIT | Copyright (c) 2015-present Dan Abramov | [T5](#t5) | dashboard |
| `react-remove-scroll-bar` | 2.3.8 | MIT | (author) Anton Korzunov |  | dashboard |
| `react-remove-scroll` | 2.7.2 | MIT | Copyright (c) 2017 Anton Korzunov | [T1](#t1) | dashboard |
| `react-router-dom` | 7.18.6 | MIT | Copyright (c) React Training LLC 2015-2019<br>Copyright (c) Remix Software Inc. 2020-2021<br>Copyright (c) Shopify Inc. 2022-2023 | [T1](#t1) | dashboard |
| `react-router` | 7.18.6 | MIT | Copyright (c) React Training LLC 2015-2019<br>Copyright (c) Remix Software Inc. 2020-2021<br>Copyright (c) Shopify Inc. 2022-2023 | [T1](#t1) | dashboard |
| `react-smooth` | 4.0.4 | MIT | Copyright (c) 2016 recharts | [T5](#t5) | dashboard |
| `react-style-singleton` | 2.2.3 | MIT | Copyright (c) 2017 Anton Korzunov | [T1](#t1) | dashboard |
| `react-toastify` | 11.1.0 | MIT | Copyright (c) Fadi Khadra | [T1](#t1) | dashboard |
| `react-transition-group` | 4.4.5 | BSD-3-Clause | Copyright (c) 2018, React Community | [T76](#t76) | dashboard |
| `react` | 18.3.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. | [T1](#t1) | dashboard |
| `read-cache` | 1.0.0 | MIT | Copyright 2016 Bogdan Chadkin &lt;trysound@yandex.ru&gt;<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `readable-stream` | 2.3.8 | MIT | Copyright Node.js contributors. All rights reserved.<br>Copyright Joyent, Inc. and other Node contributors. All rights reserved. | [T77](#t77) | external-integrations, file-management, gateway |
| `readable-stream` | 3.6.2 | MIT | Copyright Node.js contributors. All rights reserved.<br>Copyright Joyent, Inc. and other Node contributors. All rights reserved. | [T77](#t77) | gateway |
| `readable-stream` | 4.7.0 | MIT | Copyright Node.js contributors. All rights reserved.<br>Copyright Joyent, Inc. and other Node contributors. All rights reserved. | [T77](#t77) | gateway |
| `readable-stream` | 4.8.0 | MIT | Copyright Node.js contributors. All rights reserved.<br>Copyright Joyent, Inc. and other Node contributors. All rights reserved. | [T77](#t77) | external-integrations, file-management |
| `readdir-glob` | 1.1.3 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2020 Yann Armelin | [T3](#t3) | external-integrations, file-management |
| `readdirp` | 3.6.0 | MIT | Copyright (c) 2012-2019 Thorsten Lorenz, Paul Miller (https://paulmillr.com) | [T1](#t1) | dashboard |
| `real-require` | 0.2.0 | MIT | Copyright (c) 2021 Paolo Insogna and the real-require contributors | [T5](#t5) | analysis-reporting, gateway |
| `real-require` | 1.0.0 | MIT | Copyright (c) 2021 Paolo Insogna and the real-require contributors | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `recharts-scale` | 0.4.5 | MIT | Copyright (c) 2015 Sen Yang | [T5](#t5) | dashboard |
| `recharts` | 2.15.4 | MIT | Copyright (c) 2015-present recharts | [T5](#t5) | dashboard |
| `redis-errors` | 1.2.0 | MIT | Copyright (c) 2017 Ruben Bridgewater | [T5](#t5) | analysis-reporting, external-integrations, gateway, global-management, mcp, policy-management, security-scanning |
| `redis-parser` | 3.0.0 | MIT | Copyright (c) 2015 NodeRedis | [T5](#t5) | analysis-reporting, external-integrations, gateway, global-management, mcp, policy-management, security-scanning |
| `redux-thunk` | 3.1.0 | MIT | Copyright (c) 2015-present Dan Abramov | [T5](#t5) | dashboard |
| `redux` | 5.0.1 | MIT | Copyright (c) 2015-present Dan Abramov | [T5](#t5) | dashboard |
| `reflect-metadata` | 0.2.2 | Apache-2.0 | (author) Ron Buckton | [T78](#t78) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `regenerator-runtime` | 0.13.11 | MIT | Copyright (c) 2014-present, Facebook, Inc. | [T1](#t1) | dashboard |
| `remark-gfm` | 4.0.1 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `remark-parse` | 11.0.0 | MIT | Copyright (c) 2014 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T57](#t57) | dashboard |
| `remark-rehype` | 11.1.2 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `remark-stringify` | 11.0.0 | MIT | Copyright (c) 2014 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T57](#t57) | dashboard |
| `require-directory` | 2.1.1 | MIT | Copyright (c) 2011 Troy Goode &lt;troygoode@gmail.com&gt; | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `require-from-string` | 2.0.2 | MIT | Copyright (c) Vsevolod Strukchinsky &lt;floatdrop@gmail.com&gt; (github.com/floatdrop) | [T5](#t5) | gateway, mcp |
| `require-in-the-middle` | 8.0.1 | MIT | Copyright (c) 2016-2019, Thomas Watson Steen<br>Copyright (c) 2019-2025, Elasticsearch B.V.<br>Copyright (c) 2025+, require-in-the-middle contributors | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `reselect` | 5.1.1 | MIT | Copyright (c) 2015-2018 Reselect Contributors | [T5](#t5) | dashboard |
| `resolve` | 1.22.12 | MIT | Copyright (c) 2012 James Halliday | [T1](#t1) | dashboard |
| `ret` | 0.5.1 | MIT | Copyright (C) 2011 by fent | [T1](#t1) | gateway, mcp |
| `reusify` | 1.1.0 | MIT | Copyright (c) 2015-2024 Matteo Collina | [T5](#t5) | dashboard, gateway, mcp |
| `rfc4648` | 1.5.4 | MIT | Copyright © 2022 William R Swanson | [T38](#t38) | security-scanning |
| `rfdc` | 1.4.1 | MIT | Copyright 2019 "David Mark Clements &lt;david.mark.clements@gmail.com&gt;" | [T15](#t15) | gateway, mcp |
| `rgbcolor` | 1.0.1 | MIT OR SEE LICENSE IN FEEL-FREE.md | Copyright (c) 2016 Stoyan Stefanov, http://phpied.com/ | [T79](#t79) | dashboard |
| `rimraf` | 5.0.10 | ISC | Copyright (c) 2011-2023 Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | external-integrations, file-management, global-management, policy-management |
| `router` | 2.2.0 | MIT | Copyright (c) 2013 Roman Shtylman<br>Copyright (c) 2014-2022 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `run-parallel` | 1.2.0 | MIT | Copyright (c) Feross Aboukhadijeh<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | dashboard |
| `rxjs` | 7.8.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright (c) 2015-2018 Google, Inc., Netflix, Inc., Microsoft Corp. and contributors | [T3](#t3) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `safe-buffer` | 5.1.2 | MIT | Copyright (c) Feross Aboukhadijeh | [T5](#t5) | external-integrations, file-management, gateway |
| `safe-buffer` | 5.2.1 | MIT | Copyright (c) Feross Aboukhadijeh | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `safe-regex2` | 5.1.2 | MIT | Copyright (c) 2019-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T1](#t1) | gateway, mcp |
| `safe-stable-stringify` | 2.5.0 | MIT | Copyright (c) Ruben Bridgewater | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `safer-buffer` | 2.1.2 | MIT | Copyright (c) 2018 Nikita Skovoroda &lt;chalkerx@gmail.com&gt; | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `scheduler` | 0.23.2 | MIT | Copyright (c) Facebook, Inc. and its affiliates. | [T1](#t1) | dashboard |
| `secure-json-parse` | 4.1.0 | BSD-3-Clause | Copyright (c) 2019, Sideway Inc, and project contributors<br>Copyright (c) 2019-present The Fastify team | [T80](#t80) | analysis-reporting, gateway, mcp, security-scanning |
| `secure-json-parse` | 4.1.1 | BSD-3-Clause | Copyright (c) 2019, Sideway Inc, and project contributors<br>Copyright (c) 2019-present The Fastify team &lt;https://github.com/fastify/fastify#team&gt; | [T81](#t81) | external-integrations, file-management, global-management, policy-management |
| `semver` | 7.7.4 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | gateway |
| `semver` | 7.8.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting |
| `semver` | 7.8.1 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting |
| `semver` | 7.8.5 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | external-integrations, gateway, mcp, policy-management |
| `send` | 1.2.1 | MIT | Copyright (c) 2012 TJ Holowaychuk<br>Copyright (c) 2014-2022 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `serve-static` | 2.2.1 | MIT | Copyright (c) 2010 Sencha Inc.<br>Copyright (c) 2011 LearnBoost<br>Copyright (c) 2011 TJ Holowaychuk<br>Copyright (c) 2014-2016 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `set-cookie-parser` | 2.7.3 | MIT | Copyright (c) 2015 Nathan Friedly &lt;nathan@nfriedly.com&gt; (http://nfriedly.com/) | [T5](#t5) | dashboard, gateway, mcp |
| `set-cookie-parser` | 3.2.2 | MIT | Copyright (c) 2015 Nathan Friedly &lt;nathan@nfriedly.com&gt; (http://nfriedly.com/) | [T5](#t5) | gateway, mcp |
| `set-function-length` | 1.2.2 | MIT | Copyright (c) Jordan Harband and contributors | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `setprototypeof` | 1.2.0 | ISC | Copyright (c) 2015, Wes Todd<br>copyright notice and this permission notice appear in all copies. | [T54](#t54) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `sha.js` | 2.4.12 | (MIT AND BSD-3-Clause) | Copyright (c) 2013-2018 sha.js contributors<br>Copyright (c) 1998 - 2009, Paul Johnston & Contributors | [T82](#t82) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `shebang-command` | 2.0.0 | MIT | Copyright (c) Kevin Mårtensson &lt;kevinmartensson@gmail.com&gt; (github.com/kevva) | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, mcp, policy-management, security-scanning |
| `shebang-regex` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, mcp, policy-management, security-scanning |
| `side-channel-list` | 1.0.1 | MIT | Copyright (c) 2024 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `side-channel-map` | 1.0.1 | MIT | Copyright (c) 2024 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `side-channel-weakmap` | 1.0.2 | MIT | Copyright (c) 2019 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `side-channel` | 1.1.1 | MIT | Copyright (c) 2019 Jordan Harband | [T1](#t1) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `signal-exit` | 4.1.0 | ISC | Copyright (c) 2015-2023 Benjamin Coe, Isaac Z. Schlueter, and Contributors | [T83](#t83) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `slash` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | dashboard |
| `smart-buffer` | 4.2.0 | MIT | Copyright (c) 2013-2017 Josh Glazebrook<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | security-scanning |
| `socks-proxy-agent` | 8.0.5 | MIT | Copyright (c) 2013 Nathan Rajlich &lt;nathan@tootallnate.net&gt; | [T18](#t18) | security-scanning |
| `socks` | 2.8.9 | MIT | Copyright (c) 2013 Josh Glazebrook<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | security-scanning |
| `sonic-boom` | 4.2.1 | MIT | Copyright (c) 2017 Matteo Collina | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `sonic-boom` | 5.0.2 | MIT | Copyright (c) 2017 Matteo Collina | [T1](#t1) | external-integrations, file-management, global-management, policy-management |
| `source-map-js` | 1.2.2 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors | [T84](#t84) | dashboard |
| `source-map` | 0.6.1 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors | [T84](#t84) | global-management |
| `space-separated-tokens` | 2.0.2 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `split2` | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina &lt;hello@matteocollina.com&gt;<br>copyright notice and this permission notice appear in all copies. | [T54](#t54) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `sql-escaper` | 1.5.1 | MIT | Copyright (c) 2026 Weslley Araújo, Andrey Sidorov, Douglas Wilson, and contributors. | [T1](#t1) | security-scanning |
| `sql-escaper` | 1.5.2 | MIT | Copyright (c) 2026 Weslley Araújo, Andrey Sidorov, Douglas Wilson, and contributors. | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management |
| `sql-highlight` | 6.1.0 | MIT | Copyright (c) 2018 Malcolm Nihlén | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `stack-utils` | 2.0.6 | MIT | Copyright (c) 2016-2022 Isaac Z. Schlueter &lt;i@izs.me&gt;, James Talmage &lt;james@talmage.io&gt; (github.com/jamestalmage), and Contributors | [T5](#t5) | dashboard |
| `stackblur-canvas` | 2.7.0 | MIT | Copyright (c) 2010 Mario Klingemann | [T15](#t15) | dashboard |
| `standard-as-callback` | 2.1.0 | MIT | Copyright (c) 2018 Zihua Li<br>Copyright (c) 2013-2017 Petka Antonov | [T1](#t1) | analysis-reporting, external-integrations, gateway, global-management, mcp, policy-management, security-scanning |
| `statuses` | 2.0.2 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2016 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `stream-buffers` | 3.0.3 | Unlicense | (author) Sam Day |  | security-scanning |
| `stream-chain` | 4.4.1 | BSD-3-Clause | Copyright 2005-2026 Eugene Lazutkin | [T58](#t58) | analysis-reporting |
| `stream-json` | 3.7.0 | BSD-3-Clause | Copyright 2005-2026 Eugene Lazutkin | [T58](#t58) | analysis-reporting |
| `stream-shift` | 1.0.3 | MIT | Copyright (c) 2016 Mathias Buus | [T5](#t5) | gateway |
| `streamsearch` | 1.1.0 | MIT | Copyright Brian White. All rights reserved. | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `streamx` | 2.26.0 | MIT | Copyright (c) 2019 Mathias Buus | [T5](#t5) | security-scanning |
| `streamx` | 2.28.1 | MIT | Copyright (c) 2019 Mathias Buus | [T5](#t5) | external-integrations, file-management |
| `string-width` | 4.2.3 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `string-width` | 5.1.2 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `string_decoder` | 1.1.1 | MIT | Copyright Node.js contributors. All rights reserved.<br>Copyright Joyent, Inc. and other Node contributors. All rights reserved. | [T77](#t77) | external-integrations, file-management, gateway |
| `string_decoder` | 1.3.0 | MIT | Copyright Node.js contributors. All rights reserved.<br>Copyright Joyent, Inc. and other Node contributors. All rights reserved. | [T77](#t77) | external-integrations, file-management, gateway |
| `stringify-entities` | 4.0.4 | MIT | Copyright (c) 2015 Titus Wormer &lt;mailto:tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `strip-ansi` | 6.0.1 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `strip-ansi` | 7.2.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `strip-json-comments` | 5.0.3 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `strtok3` | 10.8.0 | MIT | Copyright © 2026 Borewit | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `style-to-js` | 1.1.21 | MIT | Copyright (c) 2020 Menglin "Mark" Xu &lt;mark@remarkablemark.org&gt; | [T5](#t5) | dashboard |
| `style-to-object` | 1.0.14 | MIT | Copyright (c) 2017 Menglin "Mark" Xu &lt;mark@remarkablemark.org&gt; | [T5](#t5) | dashboard |
| `sucrase` | 3.35.1 | MIT | Copyright (c) 2012-2018 various contributors (see AUTHORS) | [T5](#t5) | dashboard |
| `super-regex` | 0.2.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `supports-color` | 7.2.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | dashboard |
| `supports-preserve-symlinks-flag` | 1.0.0 | MIT | Copyright (c) 2022 Inspect JS | [T1](#t1) | dashboard |
| `svg-pathdata` | 6.0.3 | MIT | Copyright © 2017 Nicolas Froidure | [T38](#t38) | dashboard |
| `swagger-ui-dist` | 5.34.1 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | gateway |
| `systeminformation` | 5.33.16 | MIT | Copyright (c) 2014-2026 Sebastian Hildebrandt<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | security-scanning |
| `systeminformation` | 5.33.18 | MIT | Copyright (c) 2014-2026 Sebastian Hildebrandt<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | analysis-reporting, gateway, mcp |
| `systeminformation` | 5.33.22 | MIT | Copyright (c) 2014-2026 Sebastian Hildebrandt<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T34](#t34) | external-integrations, file-management, global-management, policy-management |
| `tailwind-merge` | 3.5.0 | MIT | Copyright (c) 2021 Dany Castillo | [T1](#t1) | dashboard |
| `tailwindcss` | 3.4.19 | MIT | Copyright (c) Tailwind Labs, Inc. | [T1](#t1) | dashboard |
| `tar-fs` | 3.1.2 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | security-scanning |
| `tar-stream` | 3.2.0 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | security-scanning |
| `tar-stream` | 3.2.2 | MIT | Copyright (c) 2014 Mathias Buus | [T5](#t5) | external-integrations, file-management |
| `teex` | 1.0.1 | MIT | Copyright (c) 2020 Mathias Buus | [T5](#t5) | external-integrations, file-management, security-scanning |
| `text-decoder` | 1.2.7 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | external-integrations, file-management, security-scanning |
| `text-segmentation` | 1.0.3 | MIT | Copyright (c) 2021 Niklas von Hertzen | [T15](#t15) | dashboard |
| `thenify-all` | 1.6.0 | MIT | Copyright (c) 2014 Jonathan Ong me@jongleberry.com | [T5](#t5) | dashboard |
| `thenify` | 3.3.1 | MIT | Copyright (c) 2014-2016 Jonathan Ong me@jongleberry.com and contributors | [T5](#t5) | dashboard |
| `thread-stream` | 4.0.0 | MIT | Copyright (c) 2021 Matteo Collina | [T1](#t1) | analysis-reporting, gateway |
| `thread-stream` | 4.2.1 | MIT | Copyright (c) 2021 Matteo Collina | [T1](#t1) | external-integrations, file-management, global-management, mcp, policy-management, security-scanning |
| `through2` | 2.0.5 | MIT | (author) Rod Vagg | [T85](#t85) | gateway |
| `time-span` | 5.1.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | dashboard |
| `tiny-invariant` | 1.3.3 | MIT | Copyright (c) 2019 Alexander Reardon | [T1](#t1) | dashboard |
| `tinyglobby` | 0.2.17 | MIT | Copyright (c) 2024 Madeline Gurriarán | [T1](#t1) | dashboard |
| `to-buffer` | 1.2.2 | MIT | Copyright (c) 2016 Mathias Buus | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `to-regex-range` | 5.0.1 | MIT | Copyright (c) 2015-present, Jon Schlinkert. | [T5](#t5) | dashboard |
| `toad-cache` | 3.7.0 | MIT | Copyright (c) 2023 Igor Savin | [T1](#t1) | mcp |
| `toad-cache` | 3.7.4 | MIT | Copyright (c) 2023 Igor Savin | [T1](#t1) | external-integrations, gateway, mcp |
| `toidentifier` | 1.0.1 | MIT | Copyright (c) 2016 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `token-types` | 6.1.2 | MIT | Copyright © 2026 Borewit | [T5](#t5) | analysis-reporting, gateway, mcp, security-scanning |
| `token-types` | 6.2.0 | MIT | Copyright © 2026 Borewit | [T5](#t5) | external-integrations, file-management, global-management, policy-management |
| `tr46` | 0.0.3 | MIT | (author) Sebastian Mayr |  | security-scanning |
| `trim-lines` | 3.0.1 | MIT | Copyright (c) 2015 Titus Wormer &lt;mailto:tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `trough` | 2.2.0 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T57](#t57) | dashboard |
| `ts-error` | 1.0.6 | MIT | Copyright (c) 2018 Frédérique Mittelstaedt | [T1](#t1) | gateway, global-management |
| `ts-interface-checker` | 0.1.13 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright {yyyy} {name of copyright owner} | [T2](#t2) | dashboard |
| `ts-node` | 10.9.2 | MIT | Copyright (c) 2014 Blake Embrey (hello@blakeembrey.com) | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `ts-poet` | 6.12.0 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | file-management |
| `ts-proto-descriptors` | 2.1.0 | ISC |  |  | file-management |
| `ts-proto` | 2.20.0 | ISC | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright [yyyy] [name of copyright owner] | [T3](#t3) | file-management |
| `tslib` | 2.8.1 | 0BSD | Copyright (c) Microsoft Corporation. | [T86](#t86) | analysis-reporting, dashboard, external-integrations, gateway, mcp, policy-management, security-scanning |
| `tslib` | 2.9.1 | 0BSD | Copyright (c) Microsoft Corporation. | [T86](#t86) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `type-is` | 1.6.18 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `type-is` | 2.1.0 | MIT | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;<br>Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `typed-array-buffer` | 1.0.3 | MIT | Copyright (c) 2023 Jordan Harband | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `typed-query-selector` | 2.12.2 | MIT | Copyright (c) 2020-present Pig Fang | [T1](#t1) | analysis-reporting |
| `typeorm` | 0.3.31 | MIT | (author) TypeORM |  | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `typescript` | 6.0.3 | Apache-2.0 | (author) Microsoft Corp. | [T78](#t78) | analysis-reporting, dashboard, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `uglify-js` | 3.19.3 | BSD-2-Clause | Copyright 2012-2024 (c) Mihai Bazon &lt;mihai.bazon@gmail.com&gt;<br>copyright notice, this list of conditions and the following<br>copyright notice, this list of conditions and the following | [T87](#t87) | global-management |
| `uid` | 2.0.2 | MIT | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `uint8array-extras` | 1.6.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `ulid` | 3.0.2 | MIT | Copyright (c) 2017 Alizain Feerasta | [T5](#t5) | analysis-reporting, gateway, global-management, policy-management, security-scanning |
| `undici-types` | 7.16.0 | MIT | Copyright (c) Matteo Collina and Undici contributors | [T1](#t1) | analysis-reporting, dashboard, gateway, mcp, security-scanning |
| `undici-types` | 7.24.6 | MIT | Copyright (c) Matteo Collina and Undici contributors | [T1](#t1) | external-integrations, file-management, global-management, policy-management |
| `unified` | 11.0.5 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T57](#t57) | dashboard |
| `unist-util-is` | 6.0.1 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T88](#t88) | dashboard |
| `unist-util-position` | 5.0.0 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `unist-util-stringify-position` | 4.0.0 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `unist-util-visit-parents` | 6.0.2 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `unist-util-visit` | 5.1.0 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `universal-github-app-jwt` | 2.2.2 | MIT | Copyright (c) 2019 Gregor Martynus | [T19](#t19) | external-integrations |
| `universal-user-agent` | 7.0.3 | ISC | Copyright (c) 2018-2021, Gregor Martynus (https://github.com/gr2m) | [T89](#t89) | external-integrations |
| `universalify` | 2.0.1 | MIT | Copyright (c) 2017, Ryan Zimmerman &lt;opensrc@ryanzim.com&gt;<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T90](#t90) | file-management |
| `unpipe` | 1.0.0 | MIT | Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `unzipper` | 0.12.5 | MIT | Copyright (c) 2012 - 2013 Near Infinity Corporation | [T91](#t91) | file-management |
| `use-callback-ref` | 1.3.3 | MIT | Copyright (c) 2017 Anton Korzunov | [T1](#t1) | dashboard |
| `use-sidecar` | 1.1.3 | MIT | Copyright (c) 2017 Anton Korzunov | [T1](#t1) | dashboard |
| `use-sync-external-store` | 1.6.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | [T1](#t1) | dashboard |
| `util-deprecate` | 1.0.2 | MIT | Copyright (c) 2014 Nathan Rajlich &lt;nathan@tootallnate.net&gt; | [T57](#t57) | dashboard, external-integrations, file-management, gateway |
| `utrie` | 1.0.2 | MIT | Copyright (c) 2021 Niklas von Hertzen | [T15](#t15) | dashboard |
| `uuid` | 11.1.1 | MIT | Copyright (c) 2010-2020 Robert Kieffer and other contributors | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `uuid` | 14.0.3 | MIT | Copyright (c) 2010-2020 Robert Kieffer and other contributors | [T5](#t5) | external-integrations, file-management, gateway, policy-management, security-scanning |
| `v8-compile-cache-lib` | 3.0.1 | MIT | Copyright (c) 2019 Andres Suarez | [T5](#t5) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `validator` | 13.15.35 | MIT | Copyright (c) 2018 Chris O'Hara &lt;cohara87@gmail.com&gt; | [T15](#t15) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `vary` | 1.1.2 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson | [T18](#t18) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `vfile-message` | 4.0.3 | MIT | Copyright (c) Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |
| `vfile` | 6.0.3 | MIT | Copyright (c) 2015 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T57](#t57) | dashboard |
| `victory-vendor` | 36.9.2 | MIT AND ISC | (author) Formidable |  | dashboard |
| `void-elements` | 3.1.0 | MIT | Copyright (c) 2014 hemanth | [T18](#t18) | dashboard |
| `web-streams-polyfill` | 3.3.3 | MIT | Copyright (c) 2024 Mattias Buelens<br>Copyright (c) 2016 Diwank Singh Tomer | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `web-vitals` | 4.2.4 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2020 Google LLC | [T92](#t92) | dashboard |
| `webdriver-bidi-protocol` | 0.4.2 | Apache-2.0 | copyright notice that is included in or attached to the work<br>copyright license to reproduce, prepare Derivative Works of,<br>(c) You must retain, in the Source form of any Derivative Works<br>Copyright 2024 Google Inc. | [T3](#t3) | analysis-reporting |
| `webidl-conversions` | 3.0.1 | BSD-2-Clause | Copyright (c) 2014, Domenic Denicola | [T93](#t93) | security-scanning |
| `whatwg-url` | 5.0.0 | MIT | Copyright (c) 2015–2016 Sebastian Mayr | [T5](#t5) | security-scanning |
| `which-typed-array` | 1.1.20 | MIT | Copyright (c) 2015 Jordan Harband | [T5](#t5) | analysis-reporting |
| `which-typed-array` | 1.1.22 | MIT | Copyright (c) 2015 Jordan Harband | [T5](#t5) | security-scanning |
| `which-typed-array` | 1.1.24 | MIT | Copyright (c) 2015 Jordan Harband | [T5](#t5) | external-integrations, file-management, global-management, policy-management |
| `which` | 2.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting, external-integrations, file-management, global-management, mcp, policy-management, security-scanning |
| `wordwrap` | 1.0.0 | MIT | COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T65](#t65) | global-management |
| `wrap-ansi` | 7.0.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `wrap-ansi` | 8.1.0 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `wrappy` | 1.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors<br>copyright notice and this permission notice appear in all copies. | [T28](#t28) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `ws` | 8.22.0 | MIT | Copyright (c) 2011 Einar Otto Stangvik &lt;einaros@gmail.com&gt;<br>Copyright (c) 2013 Arnout Kazemier and contributors<br>Copyright (c) 2016 Luigi Pinca and contributors<br>COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER | [T94](#t94) | analysis-reporting, security-scanning |
| `xtend` | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. | [T5](#t5) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `y18n` | 5.0.8 | ISC | Copyright (c) 2015, Contributors | [T13](#t13) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `yaml` | 2.8.4 | ISC | Copyright Eemeli Aro &lt;eemeli@gmail.com&gt; | [T13](#t13) | analysis-reporting, mcp |
| `yaml` | 2.9.0 | ISC | Copyright Eemeli Aro &lt;eemeli@gmail.com&gt; | [T13](#t13) | security-scanning |
| `yaml` | 2.9.1 | ISC | Copyright Eemeli Aro &lt;eemeli@gmail.com&gt; | [T13](#t13) | external-integrations, file-management, gateway, global-management, policy-management |
| `yargs-parser` | 21.1.1 | ISC | Copyright (c) 2016, Contributors | [T13](#t13) | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `yargs` | 17.7.2 | MIT | Copyright 2010 James Halliday (mail@substack.net); Modified work Copyright 2014 Contributors (ben@npmjs.com) | [T1](#t1) | analysis-reporting, mcp, security-scanning |
| `yargs` | 17.7.3 | MIT | Copyright 2010 James Halliday (mail@substack.net); Modified work Copyright 2014 Contributors (ben@npmjs.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, gateway, global-management, policy-management, security-scanning |
| `yauzl` | 3.4.0 | MIT | Copyright (c) 2014 Josh Wolfe | [T5](#t5) | external-integrations, file-management |
| `yn` | 3.1.1 | MIT | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) | [T1](#t1) | analysis-reporting, external-integrations, file-management, global-management, policy-management, security-scanning |
| `zip-stream` | 6.0.1 | MIT | Copyright (c) 2014 Chris Talkington, contributors. | [T15](#t15) | external-integrations, file-management |
| `zod-to-json-schema` | 3.25.2 | ISC | Copyright (c) 2020, Stefan Terdell<br>copyright notice and this permission notice appear in all copies. | [T26](#t26) | mcp |
| `zod` | 4.6.7 | MIT | Copyright (c) 2025 Colin McDonnell | [T1](#t1) | analysis-reporting, mcp |
| `zwitch` | 2.0.4 | MIT | Copyright (c) 2016 Titus Wormer &lt;tituswormer@gmail.com&gt; | [T18](#t18) | dashboard |

## 2. NOTICE files

Reproduced verbatim from each package that ships one.

### @playwright/test@1.59.1

```text
Playwright
Copyright (c) Microsoft Corporation

This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer),
available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).
```

### bare-path@3.0.0

```text
Copyright 2023 Holepunch Inc

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

---

Copyright Joyent, Inc. and other Node contributors.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.
```

### bare-path@3.1.3

```text
Copyright 2023 Holepunch Inc

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

---

Copyright Joyent, Inc. and other Node contributors.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.
```

### es-toolkit@1.53.1

```text
es-toolkit

Parts of the test suite and compatibility layer in es-toolkit/compat are
derived from Lodash (https://github.com/lodash/lodash).

Lodash copyright notice and MIT permission notice:

Copyright OpenJS Foundation and other contributors <https://openjsf.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### import-in-the-middle@3.0.1

```text
import-in-the-middle is licensed for use as follows:

Copyright 2024 Node.js contributors. All rights reserved.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

This license applies to parts of import-in-the-middle originating from the
https://github.com/DataDog/import-in-the-middle repository:

    This product includes software developed at Datadog (https://www.datadoghq.com/).

    Copyright 2021 Datadog, Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
```

### import-in-the-middle@3.6.0

```text
import-in-the-middle is licensed for use as follows:

Copyright 2024 Node.js contributors. All rights reserved.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

This license applies to parts of import-in-the-middle originating from the
https://github.com/DataDog/import-in-the-middle repository:

    This product includes software developed at Datadog (https://www.datadoghq.com/).

    Copyright 2021 Datadog, Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
```

### playwright-core@1.59.1

```text
Playwright
Copyright (c) Microsoft Corporation

This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer),
available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).
```

### playwright@1.59.1

```text
Playwright
Copyright (c) Microsoft Corporation

This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer),
available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).
```

### swagger-ui-dist@5.34.1

```text
swagger-ui
Copyright 2020-2021 SmartBear Software Inc.
```

## 3. Fonts, icons and logos

- **Font Awesome Free** (`@fortawesome/*` packages, in the dashboard bundle). Icons by Font Awesome, https://fontawesome.com, by Fonticons, Inc.:
  the icons are licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), the fonts under the SIL OFL 1.1, the code under the MIT licence
  (https://fontawesome.com/license/free). The dashboard embeds the icons as SVG paths. The brand icons are trademarks of their owners.
- **react-icons** (dashboard bundle), MIT. The dashboard uses its Simple Icons set (`react-icons/si`), whose icon data is CC0 1.0
  (https://github.com/simple-icons/simple-icons); the brands those icons depict are trademarks of their owners.
- **@fontsource/jetbrains-mono** (font files embedded in generated PDF reports), SIL Open Font License 1.1. Its copyright and licence text are in sections 1 and 5.
- **@fontsource/rubik** (font files embedded in generated PDF reports), SIL Open Font License 1.1. Its copyright and licence text are in sections 1 and 5.
- **Fonts loaded by the browser.** The dashboard page asks the browser to load Rubik, Geist and Geist Mono from Google Fonts. Those fonts are not part of the images; they are licensed under the SIL Open Font License 1.1.
- **Fonts in the analysis-reporting image** (used by the PDF renderer): GNU FreeFont (`font-freefont`, GPL-3.0-or-later with the font exception) and Noto Emoji (`font-noto-emoji`, OFL-1.1), installed from Alpine Linux (section 4).
- **Integration logos.** The logos shown for third-party integrations (source hosts, issue trackers, registries, cloud providers, IDEs) are trademarks of their owners. They are used only to identify the integration and are not covered by the licence of this repository.

## 4. Container images: operating-system packages

The service images are built on the official `node` image and the dashboard image on the official `nginx` image, both on Alpine Linux 3.24.
Each image also contains the Alpine packages listed below, under their own licences.

- **Node.js** (MIT, with the third-party licences listed in its own `LICENSE` file) and **npm** (Artistic-2.0) come with the `node` base image.
  Source: https://github.com/nodejs/node and https://github.com/npm/cli. The service images also install **pnpm** (MIT, https://github.com/pnpm/pnpm) globally.
- **nginx** (BSD-2-Clause) comes with the `nginx` base image. Source: https://nginx.org/en/download.html.
- **Alpine Linux packages.** The corresponding source of every Alpine package, including the GPL and LGPL ones, is its build recipe in the Alpine aports tree on the `3.24-stable` branch, https://gitlab.alpinelinux.org/alpine/aports/-/tree/3.24-stable (directory `main/<origin>` or `community/<origin>`), and the upstream source archives that recipe names, mirrored at https://distfiles.alpinelinux.org/distfiles/v3.24/. The licence texts are in each upstream archive.
  The image build installs the current revision of each package on that branch, so a later build may carry a later revision than the one listed here; the source of each revision stays in the aports history.

### Packages each image adds

| Image | Base image | Packages added by its Dockerfile |
|---|---|---|
| analysis-reporting | `node:26.13.1-alpine3.24` | `ca-certificates`, `openssl`, `chromium`, `nss`, `freetype`, `harfbuzz`, `ttf-freefont`, `font-noto-emoji`, `git` |
| dashboard | `nginx:1.31.9-alpine3.24` | (none) |
| external-integrations | `node:26.13.1-alpine3.24` | `ca-certificates`, `openssl`, `git`, `tini` |
| file-management | `node:26.13.1-alpine3.24` | `ca-certificates`, `openssl` |
| gateway | `node:26.13.1-alpine3.24` | `ca-certificates`, `openssl` |
| global-management | `node:26.13.1-alpine3.24` | `ca-certificates`, `openssl` |
| mcp | `node:26.13.1-alpine3.24` | `ca-certificates`, `openssl` |
| policy-management | `node:26.13.1-alpine3.24` | `ca-certificates`, `openssl` |
| security-scanning | `node:26.13.1-alpine3.24` | `ca-certificates`, `openssl` |

| Requested name | Installed package | Licence |
|---|---|---|
| `ca-certificates` | ca-certificates | MPL-2.0 AND MIT |
| `chromium` | chromium | BSD-3-Clause |
| `font-noto-emoji` | font-noto-emoji | OFL-1.1 |
| `freetype` | freetype | FTL OR GPL-2.0-or-later |
| `git` | git | GPL-2.0-only |
| `harfbuzz` | harfbuzz | MIT |
| `nss` | nss | MPL-2.0 |
| `openssl` | openssl | Apache-2.0 |
| `tini` | tini | MIT |
| `ttf-freefont` | font-freefont | GPL-3.0-or-later |

### Every Alpine package in the images

| Package | Version | Origin (aports) | Licence | Images |
|---|---|---|---|---|
| `abseil-cpp-raw-logging-internal` | 20250814.1-r0 | abseil-cpp | Apache-2.0 | analysis-reporting |
| `abseil-cpp-strings-internal` | 20250814.1-r0 | abseil-cpp | Apache-2.0 | analysis-reporting |
| `abseil-cpp-strings` | 20250814.1-r0 | abseil-cpp | Apache-2.0 | analysis-reporting |
| `alpine-baselayout-data` | 3.7.2-r1 | alpine-baselayout | GPL-2.0-only | all |
| `alpine-baselayout` | 3.7.2-r1 | alpine-baselayout | GPL-2.0-only | all |
| `alpine-keys` | 2.6-r0 | alpine-keys | MIT | all |
| `alpine-release` | 3.24.4-r0 | alpine-base | MIT | all |
| `alsa-lib` | 1.2.15.3-r0 | alsa-lib | LGPL-2.1-or-later | analysis-reporting |
| `aom-libs` | 3.14.1-r0 | aom | BSD-2-Clause AND custom | analysis-reporting, dashboard |
| `apk-tools` | 3.0.9-r0 | apk-tools | GPL-2.0-only | all |
| `at-spi2-core-libs` | 2.60.5-r0 | at-spi2-core | LGPL-2.1-or-later | analysis-reporting |
| `at-spi2-core` | 2.60.5-r0 | at-spi2-core | LGPL-2.1-or-later | analysis-reporting |
| `avahi-libs` | 0.9_rc4-r0 | avahi | LGPL-2.1-or-later | analysis-reporting |
| `brotli-libs` | 1.2.1-r0 | brotli | MIT | analysis-reporting, dashboard, external-integrations |
| `bubblewrap` | 0.12.0-r0 | bubblewrap | LGPL-2.1-or-later | analysis-reporting |
| `busybox-binsh` | 1.37.0-r31 | busybox | GPL-2.0-only | all |
| `busybox` | 1.37.0-r31 | busybox | GPL-2.0-only | all |
| `c-ares` | 1.34.9-r0 | c-ares | MIT | analysis-reporting, dashboard, external-integrations |
| `ca-certificates-bundle` | 20261020-r0 | ca-certificates | MPL-2.0 AND MIT | all |
| `ca-certificates` | 20261020-r0 | ca-certificates | MPL-2.0 AND MIT | all |
| `cairo-gobject` | 1.18.4-r1 | cairo | LGPL-2.1-or-later OR MPL-1.1 | analysis-reporting |
| `cairo` | 1.18.4-r1 | cairo | LGPL-2.1-or-later OR MPL-1.1 | analysis-reporting |
| `cdparanoia-libs` | 10.2-r14 | cdparanoia | LGPL-2.1-or-later | analysis-reporting |
| `chromium-angle` | 158.0.8127.36-r0 | chromium | BSD-3-Clause | analysis-reporting |
| `chromium-common` | 158.0.8127.36-r0 | chromium | BSD-3-Clause | analysis-reporting |
| `chromium` | 158.0.8127.36-r0 | chromium | BSD-3-Clause | analysis-reporting |
| `cjson` | 1.7.19-r1 | cjson | MIT | analysis-reporting |
| `crc32c` | 1.1.2-r3 | crc32c | BSD-3-Clause | analysis-reporting |
| `cups-libs` | 2.4.19-r1 | cups | Apache-2.0 | analysis-reporting |
| `curl` | 8.23.0-r0 | curl | curl | dashboard |
| `dbus-libs` | 1.16.2-r2 | dbus | AFL-2.1 OR GPL-2.0-or-later | analysis-reporting |
| `directfb` | 1.7.7-r8 | directfb | LGPL-2.0-or-later | analysis-reporting |
| `double-conversion` | 3.4.0-r0 | double-conversion | BSD-3-Clause | analysis-reporting |
| `encodings` | 1.1.0-r0 | encodings | Public Domain | analysis-reporting |
| `eudev-libs` | 3.2.14-r6 | eudev | GPL-2.0-or-later | analysis-reporting |
| `faac` | 1.31.1-r0 | faac | GPL-3.0-or-later | analysis-reporting |
| `faad2-libs` | 2.11.2-r0 | faad2 | GPL-2.0-or-later | analysis-reporting |
| `fdk-aac` | 2.0.2-r4 | fdk-aac | FDK-AAC | analysis-reporting |
| `ffmpeg-libavcodec` | 8.1.3-r0 | ffmpeg | GPL-2.0-or-later AND LGPL-2.1-or-later | analysis-reporting |
| `ffmpeg-libavformat` | 8.1.3-r0 | ffmpeg | GPL-2.0-or-later AND LGPL-2.1-or-later | analysis-reporting |
| `ffmpeg-libavutil` | 8.1.3-r0 | ffmpeg | GPL-2.0-or-later AND LGPL-2.1-or-later | analysis-reporting |
| `ffmpeg-libswresample` | 8.1.3-r0 | ffmpeg | GPL-2.0-or-later AND LGPL-2.1-or-later | analysis-reporting |
| `file` | 5.47-r2 | file | BSD-2-Clause | analysis-reporting |
| `flite` | 2.2-r6 | flite | BSD-4-Clause | analysis-reporting |
| `font-freefont` | 20120503-r4 | font-freefont | GPL-3.0-or-later | analysis-reporting |
| `font-noto-emoji` | 2.051-r0 | font-noto-emoji | OFL-1.1 | analysis-reporting |
| `font-opensans` | 0_git20210927-r1 | font-opensans | Apache-2.0 | analysis-reporting |
| `fontconfig` | 2.17.1-r1 | fontconfig | MIT | analysis-reporting, dashboard |
| `freetype` | 2.14.3-r0 | freetype | FTL OR GPL-2.0-or-later | analysis-reporting, dashboard |
| `fribidi` | 1.0.16-r3 | fribidi | LGPL-2.1-or-later | analysis-reporting |
| `gdk-pixbuf` | 2.44.7-r1 | gdk-pixbuf | LGPL-2.1-or-later | analysis-reporting |
| `geoip` | 1.6.12-r6 | geoip | LGPL-2.1-or-later | dashboard |
| `gettext-envsubst` | 1.0-r0 | gettext | GPL-3.0-or-later AND LGPL-2.1-or-later AND MIT | dashboard |
| `git-init-template` | 2.54.1-r0 | git | GPL-2.0-only | analysis-reporting, external-integrations |
| `git` | 2.54.1-r0 | git | GPL-2.0-only | analysis-reporting, external-integrations |
| `glib` | 2.88.4-r0 | glib | LGPL-2.1-or-later | analysis-reporting |
| `glycin-image-rs` | 2.1.5-r0 | glycin | MPL-2.0 OR LGPL-2.0-or-later | analysis-reporting |
| `glycin-svg` | 2.1.5-r0 | glycin | MPL-2.0 OR LGPL-2.0-or-later | analysis-reporting |
| `gmp` | 6.3.0-r4 | gmp | LGPL-3.0-or-later OR GPL-2.0-or-later | analysis-reporting |
| `gnutls` | 3.8.14-r0 | gnutls | LGPL-2.1-or-later | analysis-reporting |
| `gobject-introspection` | 1.86.0-r1 | gobject-introspection | LGPL-2.0-or-later AND GPL-2.0-or-later AND MIT | analysis-reporting |
| `graphene` | 1.10.8-r5 | graphene | MIT | analysis-reporting |
| `graphite2` | 1.3.14-r6 | graphite2 | LGPL-2.1-or-later OR MPL-1.1 | analysis-reporting |
| `gsm` | 1.0.23-r0 | gsm | TU-Berlin-2.0 | analysis-reporting |
| `gst-plugins-bad` | 1.28.3-r0 | gst-plugins-bad | GPL-2.0-or-later LGPL-2.0-or-later | analysis-reporting |
| `gst-plugins-base` | 1.28.3-r0 | gst-plugins-base | GPL-2.0-or-later AND LGPL-2.0-or-later | analysis-reporting |
| `gstreamer-ptp-helper` | 1.28.3-r0 | gstreamer | LGPL-2.0-or-later | analysis-reporting |
| `gstreamer` | 1.28.3-r0 | gstreamer | LGPL-2.0-or-later | analysis-reporting |
| `gtk+3.0` | 3.24.52-r0 | gtk+3.0 | LGPL-2.1-or-later | analysis-reporting |
| `gtk-update-icon-cache` | 3.24.52-r0 | gtk+3.0 | LGPL-2.1-or-later | analysis-reporting |
| `gtk4.0` | 4.22.4-r0 | gtk4.0 | LGPL-2.1-or-later | analysis-reporting |
| `harfbuzz-subset` | 13.2.1-r0 | harfbuzz | MIT | analysis-reporting |
| `harfbuzz` | 13.2.1-r0 | harfbuzz | MIT | analysis-reporting |
| `hicolor-icon-theme` | 0.18-r0 | hicolor-icon-theme | GPL-2.0-or-later | analysis-reporting |
| `hwdata-pci` | 0.408-r0 | hwdata | GPL-2.0-or-later OR XFree86-1.1 | analysis-reporting |
| `icu-data-full` | 78.1-r0 | icu | ICU | analysis-reporting |
| `imath` | 3.2.2-r1 | imath | BSD-3-Clause | analysis-reporting |
| `iso-codes` | 4.20.1-r0 | iso-codes | LGPL-2.1-or-later | analysis-reporting |
| `lame-libs` | 3.100-r5 | lame | LGPL-2.0-or-later | analysis-reporting |
| `lcms2` | 2.19-r0 | lcms2 | MIT | analysis-reporting |
| `libSvtAv1Enc` | 4.1.0-r0 | svt-av1 | BSD-3-Clause-Clear | analysis-reporting |
| `libapk` | 3.0.9-r0 | apk-tools | GPL-2.0-only | all |
| `libass` | 0.17.4-r1 | libass | ISC | analysis-reporting |
| `libasyncns` | 0.8-r5 | libasyncns | LGPL-2.0-or-later | analysis-reporting |
| `libatk-1.0` | 2.60.5-r0 | at-spi2-core | LGPL-2.1-or-later | analysis-reporting |
| `libatk-bridge-2.0` | 2.60.5-r0 | at-spi2-core | LGPL-2.1-or-later | analysis-reporting |
| `libatomic` | 15.2.0-r5 | gcc | GPL-2.0-or-later AND LGPL-2.1-or-later | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `libavif` | 1.4.1-r0 | libavif | BSD-2-Clause | dashboard |
| `libblkid` | 2.42.3-r1 | util-linux | LGPL-2.1-or-later | analysis-reporting |
| `libbluray` | 1.4.0-r0 | libbluray | LGPL-2.1-or-later | analysis-reporting |
| `libbsd` | 0.12.2-r0 | libbsd | BSD-3-Clause | analysis-reporting, dashboard |
| `libbz2` | 1.0.8-r6 | bzip2 | bzip2-1.0.6 | analysis-reporting, dashboard |
| `libcamera-ipa` | 0.7.1-r1 | libcamera | LGPL-2.1-or-later AND GPL-2.0-or-later | analysis-reporting |
| `libcamera` | 0.7.1-r1 | libcamera | LGPL-2.1-or-later AND GPL-2.0-or-later | analysis-reporting |
| `libcap2` | 2.78-r0 | libcap | BSD-3-Clause OR GPL-2.0-only | analysis-reporting |
| `libcrypto3` | 3.5.9-r0 | openssl | Apache-2.0 | dashboard |
| `libcrypto3` | 3.5.9-r1 | openssl | Apache-2.0 | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `libcurl` | 8.23.0-r0 | curl | curl | analysis-reporting, dashboard, external-integrations |
| `libdav1d` | 1.5.3-r0 | dav1d | BSD-2-Clause | analysis-reporting, dashboard |
| `libdc1394` | 2.2.7-r0 | libdc1394 | LGPL-2.1-or-later | analysis-reporting |
| `libde265` | 1.1.3-r0 | libde265 | LGPL-3.0-or-later | analysis-reporting |
| `libdeflate` | 1.25-r0 | libdeflate | MIT | analysis-reporting |
| `libdrm` | 2.4.134-r0 | libdrm | MIT | analysis-reporting |
| `libdvdcss` | 1.4.3-r0 | libdvdcss | GPL-2.0-or-later | analysis-reporting |
| `libdvdnav` | 6.1.1-r1 | libdvdnav | GPL-2.0-or-later | analysis-reporting |
| `libdvdread` | 6.1.3-r2 | libdvdread | GPL-2.0-or-later | analysis-reporting |
| `libeconf` | 0.8.3-r0 | libeconf | MIT | analysis-reporting |
| `libedit` | 20260508.3.1-r1 | libedit | BSD-3-Clause | dashboard |
| `libelf` | 0.195-r0 | elfutils | GPL-3.0-or-later AND ( GPL-2.0-or-later OR LGPL-3.0-or-later  | analysis-reporting |
| `libepoxy` | 1.5.10-r1 | libepoxy | MIT | analysis-reporting |
| `libexpat` | 2.10.0-r0 | expat | MIT | analysis-reporting, dashboard, external-integrations |
| `libffi` | 3.5.2-r1 | libffi | MIT | analysis-reporting |
| `libflac` | 1.4.3-r2 | flac | BSD-3-Clause AND GPL-2.0-or-later | analysis-reporting |
| `libfontenc` | 1.1.10-r0 | libfontenc | MIT | analysis-reporting |
| `libfreeaptx` | 0.2.2-r0 | libfreeaptx | LGPL-2.1-or-later | analysis-reporting |
| `libgcc` | 15.2.0-r5 | gcc | GPL-2.0-or-later AND LGPL-2.1-or-later | all |
| `libgd` | 2.3.3-r10 | gd | GD | dashboard |
| `libglycin` | 2.1.5-r0 | libglycin | MPL-2.0 OR LGPL-2.0-or-later | analysis-reporting |
| `libgomp` | 15.2.0-r5 | gcc | GPL-2.0-or-later AND LGPL-2.1-or-later | analysis-reporting |
| `libgudev` | 238-r1 | libgudev | LGPL-2.1-or-later | analysis-reporting |
| `libhwy` | 1.3.0-r0 | highway | Apache-2.0 | analysis-reporting |
| `libice` | 1.1.2-r0 | libice | X11 | analysis-reporting, dashboard |
| `libidn2` | 2.3.8-r0 | libidn2 | GPL-2.0-or-later OR LGPL-3.0-or-later | analysis-reporting, dashboard, external-integrations |
| `libintl` | 1.0-r0 | gettext | LGPL-2.1-or-later | analysis-reporting, dashboard |
| `libjpeg-turbo` | 3.1.3-r0 | libjpeg-turbo | BSD-3-Clause AND IJG AND Zlib | analysis-reporting, dashboard |
| `libjxl` | 0.11.2-r1 | libjxl | Apache-2.0 | analysis-reporting |
| `libldac` | 2.0.2.3-r1 | libldac | Apache-2.0 | analysis-reporting |
| `libltdl` | 2.6.0-r1 | libtool | LGPL-2.0-or-later AND GPL-2.0-or-later | analysis-reporting |
| `libmagic` | 5.47-r2 | file | BSD-2-Clause | analysis-reporting |
| `libmaxminddb-libs` | 1.13.3-r0 | libmaxminddb | Apache-2.0 | dashboard |
| `libmd` | 1.2.0-r0 | libmd | BSD-3-Clause AND BSD-2-Clause AND ISC AND Beerware AND Public Domain | analysis-reporting, dashboard |
| `libmodplug` | 0.8.9.0-r3 | libmodplug | custom | analysis-reporting |
| `libmount` | 2.42.3-r1 | util-linux | LGPL-2.1-or-later | analysis-reporting |
| `libncursesw` | 6.6_p20260516-r0 | ncurses | X11 | dashboard |
| `libogg` | 1.3.6-r0 | libogg | BSD-3-Clause | analysis-reporting |
| `libopenmpt` | 0.8.10-r0 | libopenmpt | BSD-3-Clause | analysis-reporting |
| `libpciaccess` | 0.19-r0 | libpciaccess | X11 | analysis-reporting |
| `libpng` | 1.6.59-r0 | libpng | Libpng | analysis-reporting, dashboard |
| `libpsl` | 0.21.5-r3 | libpsl | MIT | analysis-reporting, dashboard, external-integrations |
| `libpulse` | 17.0-r7 | pulseaudio | LGPL-2.1-or-later | analysis-reporting |
| `libraw1394` | 2.1.2-r5 | libraw1394 | LGPL-2.1-or-later | analysis-reporting |
| `librist` | 0.2.15-r0 | librist | BSD-2-Clause | analysis-reporting |
| `librsvg` | 2.62.3-r0 | librsvg | LGPL-2.1-or-later | analysis-reporting |
| `librtmp` | 2.4_git20190330-r5 | rtmpdump | GPL-2.0-or-later | analysis-reporting |
| `libseccomp` | 2.6.1-r0 | libseccomp | LGPL-2.1-or-later | analysis-reporting |
| `libsharpyuv` | 1.6.0-r0 | libwebp | BSD-3-Clause | analysis-reporting, dashboard |
| `libsm` | 1.2.6-r0 | libsm | MIT | analysis-reporting, dashboard |
| `libsndfile` | 1.2.2-r2 | libsndfile | LGPL-2.1-or-later | analysis-reporting |
| `libsodium` | 1.0.22-r0 | libsodium | ISC | analysis-reporting |
| `libsrt` | 1.5.3-r1 | libsrt | MPL-2.0 | analysis-reporting |
| `libsrtp` | 2.7.0-r0 | libsrtp | BSD-3-Clause | analysis-reporting |
| `libssh` | 0.12.2-r0 | libssh | LGPL-2.1-or-later BSD-2-Clause | analysis-reporting |
| `libssl3` | 3.5.9-r0 | openssl | Apache-2.0 | dashboard |
| `libssl3` | 3.5.9-r1 | openssl | Apache-2.0 | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `libstdc++` | 15.2.0-r5 | gcc | GPL-2.0-or-later AND LGPL-2.1-or-later | all |
| `libtasn1` | 4.21.0-r0 | libtasn1 | LGPL-2.1-or-later | analysis-reporting |
| `libtheora` | 1.2.0-r1 | libtheora | BSD-3-Clause | analysis-reporting |
| `libudfread` | 1.2.0-r1 | libudfread | LGPL-2.1-or-later | analysis-reporting |
| `libunibreak` | 6.1-r0 | libunibreak | Zlib | analysis-reporting |
| `libunistring` | 1.4.2-r0 | libunistring | GPL-2.0-or-later OR LGPL-3.0-or-later | analysis-reporting, dashboard, external-integrations |
| `libunwind` | 1.8.3-r0 | libunwind | MIT | analysis-reporting |
| `libusb` | 1.0.30-r0 | libusb | LGPL-2.1-or-later | analysis-reporting |
| `libuuid` | 2.42.3-r1 | util-linux | BSD-3-Clause | analysis-reporting, dashboard |
| `libuv` | 1.52.1-r0 | libuv | MIT | analysis-reporting |
| `libva` | 2.23.0-r0 | libva | MIT | analysis-reporting |
| `libvdpau` | 1.5-r4 | libvdpau | MIT | analysis-reporting |
| `libvorbis` | 1.3.7-r2 | libvorbis | BSD-3-Clause | analysis-reporting |
| `libvpl` | 2.15.0-r1 | libvpl | MIT | analysis-reporting |
| `libvpx` | 1.15.2-r1 | libvpx | BSD-3-Clause | analysis-reporting |
| `libwebp` | 1.6.0-r0 | libwebp | BSD-3-Clause | analysis-reporting, dashboard |
| `libwebpdemux` | 1.6.0-r0 | libwebp | BSD-3-Clause | analysis-reporting |
| `libwebpmux` | 1.6.0-r0 | libwebp | BSD-3-Clause | analysis-reporting |
| `libx11` | 1.8.14-r0 | libx11 | X11 | analysis-reporting, dashboard |
| `libxau` | 1.0.12-r0 | libxau | MIT | analysis-reporting, dashboard |
| `libxcb` | 1.17.0-r2 | libxcb | MIT | analysis-reporting, dashboard |
| `libxcomposite` | 0.4.7-r0 | libxcomposite | MIT | analysis-reporting |
| `libxcursor` | 1.2.3-r0 | libxcursor | MIT | analysis-reporting |
| `libxdamage` | 1.1.7-r0 | libxdamage | MIT | analysis-reporting |
| `libxdmcp` | 1.1.5-r1 | libxdmcp | MIT | analysis-reporting, dashboard |
| `libxext` | 1.3.7-r0 | libxext | MIT | analysis-reporting, dashboard |
| `libxfixes` | 6.0.2-r0 | libxfixes | MIT | analysis-reporting |
| `libxft` | 2.3.9-r0 | libxft | MIT | analysis-reporting |
| `libxi` | 1.8.4-r0 | libxi | MIT AND X11 | analysis-reporting |
| `libxinerama` | 1.1.6-r0 | libxinerama | MIT | analysis-reporting |
| `libxkbcommon-x11` | 1.13.1-r0 | libxkbcommon | MIT AND MIT-open-group AND HPND AND HPND-sell-variant AND LicenseRef-digital-equipment-corporation | analysis-reporting |
| `libxkbcommon` | 1.13.1-r0 | libxkbcommon | MIT AND MIT-open-group AND HPND AND HPND-sell-variant AND LicenseRef-digital-equipment-corporation | analysis-reporting |
| `libxml2` | 2.13.9-r2 | libxml2 | MIT | dashboard |
| `libxml2` | 2.13.9-r3 | libxml2 | MIT | analysis-reporting |
| `libxmu` | 1.3.1-r0 | libxmu | MIT | analysis-reporting |
| `libxpm` | 3.5.20-r0 | libxpm | X11 | dashboard |
| `libxrandr` | 1.5.5-r0 | libxrandr | MIT | analysis-reporting |
| `libxrender` | 0.9.13-r0 | libxrender | MIT | analysis-reporting |
| `libxshmfence` | 1.3.3-r0 | libxshmfence | MIT | analysis-reporting |
| `libxslt` | 1.1.43-r4 | libxslt | X11 | analysis-reporting, dashboard |
| `libxt` | 1.3.1-r0 | libxt | MIT | analysis-reporting, dashboard |
| `libxtst` | 1.2.6-r0 | libxtst | MIT | analysis-reporting |
| `libxv` | 1.0.13-r0 | libxv | MIT | analysis-reporting |
| `libxxf86vm` | 1.1.7-r0 | libxxf86vm | MIT | analysis-reporting |
| `libyuv` | 0.0.1928-r0 | libyuv | BSD-3-Clause | analysis-reporting, dashboard |
| `libzbar` | 0.23.93-r2 | zbar | LGPL-2.0-or-later | analysis-reporting |
| `libzmq` | 4.3.5-r2 | zeromq | MPL-2.0 | analysis-reporting |
| `llvm22-libs` | 22.1.3-r1 | llvm22 | Apache-2.0 | analysis-reporting |
| `mbedtls3` | 3.6.8-r0 | mbedtls3 | Apache-2.0 OR GPL-2.0-or-later | analysis-reporting |
| `mesa-dri-gallium` | 26.1.6-r0 | mesa | MIT AND SGI-B-2.0 AND BSL-1.0 | analysis-reporting |
| `mesa-egl` | 26.1.6-r0 | mesa | MIT AND SGI-B-2.0 AND BSL-1.0 | analysis-reporting |
| `mesa-gbm` | 26.1.6-r0 | mesa | MIT AND SGI-B-2.0 AND BSL-1.0 | analysis-reporting |
| `mesa-gl` | 26.1.6-r0 | mesa | MIT AND SGI-B-2.0 AND BSL-1.0 | analysis-reporting |
| `mesa-gles` | 26.1.6-r0 | mesa | MIT AND SGI-B-2.0 AND BSL-1.0 | analysis-reporting |
| `mesa` | 26.1.6-r0 | mesa | MIT AND SGI-B-2.0 AND BSL-1.0 | analysis-reporting |
| `minizip` | 1.3.2-r1 | minizip | Zlib | analysis-reporting |
| `mkfontscale` | 1.2.4-r0 | mkfontscale | MIT | analysis-reporting |
| `mpg123-libs` | 1.33.5-r0 | mpg123 | LGPL-2.1-only | analysis-reporting |
| `musl-utils` | 1.2.6-r3 | musl | MIT AND BSD-2-Clause AND GPL-2.0-or-later | all |
| `musl` | 1.2.6-r3 | musl | MIT | all |
| `ncurses-terminfo-base` | 6.6_p20260516-r0 | ncurses | X11 | dashboard |
| `neon` | 0.36.0-r0 | neon | LGPL-2.0-or-later | analysis-reporting |
| `nettle` | 3.10.2-r0 | nettle | GPL-2.0-or-later OR LGPL-3.0-or-later | analysis-reporting |
| `nghttp2-libs` | 1.70.0-r0 | nghttp2 | MIT | analysis-reporting, dashboard, external-integrations |
| `nginx-module-acme` | 1.31.9.0.4.2-r1 | nginx-module-acme | 2-clause BSD-like license | dashboard |
| `nginx-module-geoip` | 1.31.9-r1 | nginx-module-geoip | 2-clause BSD-like license | dashboard |
| `nginx-module-image-filter` | 1.31.9-r1 | nginx-module-image-filter | 2-clause BSD-like license | dashboard |
| `nginx-module-njs` | 1.31.9.1.0.2-r1 | nginx-module-njs | 2-clause BSD-like license | dashboard |
| `nginx-module-xslt` | 1.31.9-r1 | nginx-module-xslt | 2-clause BSD-like license | dashboard |
| `nginx` | 1.31.9-r1 | nginx | 2-clause BSD-like license | dashboard |
| `nspr` | 4.38.2-r0 | nspr | MPL-2.0 | analysis-reporting |
| `nss` | 3.133-r0 | nss | MPL-2.0 | analysis-reporting |
| `numactl` | 2.0.19-r0 | numactl | LGPL-2.1-only | analysis-reporting |
| `openal-soft-libs` | 1.25.2-r0 | openal-soft | LGPL-2.0-or-later | analysis-reporting |
| `openexr-libiex` | 3.4.15-r0 | openexr | BSD-3-Clause | analysis-reporting |
| `openexr-libilmthread` | 3.4.15-r0 | openexr | BSD-3-Clause | analysis-reporting |
| `openexr-libopenexr` | 3.4.15-r0 | openexr | BSD-3-Clause | analysis-reporting |
| `openexr-libopenexrcore` | 3.4.15-r0 | openexr | BSD-3-Clause | analysis-reporting |
| `openh264` | 2.6.0-r0 | openh264 | BSD-2-Clause | analysis-reporting |
| `openjpeg` | 2.5.4-r2 | openjpeg | BSD-2-Clause | analysis-reporting |
| `openssl` | 3.5.9-r1 | openssl | Apache-2.0 | analysis-reporting, external-integrations, file-management, gateway, global-management, mcp, policy-management, security-scanning |
| `opus` | 1.6.1-r0 | opus | BSD-3-Clause | analysis-reporting |
| `orc` | 0.4.41-r0 | orc | BSD-2-Clause | analysis-reporting |
| `p11-kit` | 0.26.2-r0 | p11-kit | BSD-3-Clause | analysis-reporting |
| `pango` | 1.57.1-r0 | pango | LGPL-2.1-or-later | analysis-reporting |
| `pcre2` | 10.49-r0 | pcre2 | BSD-3-Clause | analysis-reporting, dashboard, external-integrations |
| `pipewire-libs` | 1.6.8-r4 | pipewire | MIT AND LGPL-2.1-or-later | analysis-reporting |
| `pixman` | 0.46.4-r0 | pixman | MIT | analysis-reporting |
| `pkgconf` | 2.5.1-r0 | pkgconf | ISC | analysis-reporting |
| `rav1e-libs` | 0.8.1-r0 | rav1e | BSD-2-Clause custom | analysis-reporting |
| `roc-toolkit-libs` | 0.4.0-r1 | roc-toolkit | MPL-2.0 | analysis-reporting |
| `sbc` | 2.1-r0 | sbc | GPL-2.0-or-later AND LGPL-2.1-or-later | analysis-reporting |
| `scanelf` | 1.3.9-r1 | pax-utils | GPL-2.0-only | all |
| `shared-mime-info` | 2.4-r7 | shared-mime-info | GPL-2.0-or-later | analysis-reporting |
| `soundtouch` | 2.4.1-r0 | soundtouch | LGPL-2.0-or-later | analysis-reporting |
| `soxr` | 0.1.3-r7 | soxr | LGPL-2.1-or-later | analysis-reporting |
| `spandsp` | 0.0.6-r5 | spandsp | LGPL-2.1-only | analysis-reporting |
| `speexdsp` | 1.2.1-r2 | speexdsp | BSD-3-Clause | analysis-reporting |
| `spirv-tools` | 1.4.341.0-r0 | spirv-tools | Apache-2.0 | analysis-reporting |
| `sqlite-libs` | 3.53.4-r0 | sqlite | blessing | analysis-reporting |
| `ssl_client` | 1.37.0-r31 | busybox | GPL-2.0-only | all |
| `tdb-libs` | 1.4.15-r1 | tdb | LGPL-3.0-or-later | analysis-reporting |
| `tiff` | 4.7.2-r0 | tiff | libtiff | analysis-reporting, dashboard |
| `tini` | 0.19.0-r3 | tini | MIT | external-integrations |
| `tslib` | 1.24-r0 | tslib | LGPL-2.0-or-later | analysis-reporting |
| `tzdata` | 2026f-r0 | tzdata | Public-Domain | analysis-reporting, dashboard |
| `vo-aacenc` | 0.1.3-r3 | vo-aacenc | Apache-2.0 | analysis-reporting |
| `vo-amrwbenc` | 0.1.3-r3 | vo-amrwbenc | Apache-2.0 | analysis-reporting |
| `vulkan-loader` | 1.4.347-r0 | vulkan-loader | Apache-2.0 | analysis-reporting |
| `wayland-libs-client` | 1.25.0-r0 | wayland | MIT | analysis-reporting |
| `wayland-libs-cursor` | 1.25.0-r0 | wayland | MIT | analysis-reporting |
| `wayland-libs-egl` | 1.25.0-r0 | wayland | MIT | analysis-reporting |
| `webrtc-audio-processing-2` | 2.1-r1 | webrtc-audio-processing-2 | custom | analysis-reporting |
| `x264-libs` | 0.164.3108-r1 | x264 | GPL-2.0-or-later | analysis-reporting |
| `x265-libs` | 4.1-r0 | x265 | GPL-2.0-or-later | analysis-reporting |
| `xdg-utils` | 1.2.1-r1 | xdg-utils | MIT | analysis-reporting |
| `xkeyboard-config` | 2.47-r0 | xkeyboard-config | MIT | analysis-reporting |
| `xprop` | 1.2.8-r0 | xprop | MIT | analysis-reporting |
| `xset` | 1.2.5-r1 | xset | MIT | analysis-reporting |
| `xvidcore` | 1.3.7-r2 | xvidcore | GPL-2.0-or-later | analysis-reporting |
| `xz-libs` | 5.8.4-r0 | xz | GPL-2.0-or-later AND 0BSD AND Public-Domain AND LGPL-2.1-or-later | analysis-reporting, dashboard |
| `yaml` | 0.2.5-r2 | yaml | MIT | analysis-reporting |
| `zlib` | 1.3.2-r1 | zlib | Zlib | all |
| `zstd-libs` | 1.5.7-r2 | zstd | BSD-3-Clause OR GPL-2.0-or-later | analysis-reporting, dashboard, external-integrations |

## 5. Licence texts

Each text below is reproduced from the packages that ship it, with their copyright lines set apart in section 1.
A package with no text here ships no licence file; its licence is the SPDX identifier in section 1 (https://spdx.org/licenses/).

### <a id="t1"></a>T1: MIT (307 packages)

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t2"></a>T2: Apache-2.0 (31 packages)

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### <a id="t3"></a>T3: (MPL-2.0 OR Apache-2.0), Apache-2.0, ISC, MIT (212 packages)

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### <a id="t4"></a>T4: Apache-2.0 (1 package)

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.
```

### <a id="t5"></a>T5: MIT (153 packages)

```text
The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t6"></a>T6: MIT (1 package)

```text
The MIT License

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t7"></a>T7: MIT (3 packages)

```text
MIT License

The Fastify team members are listed at https://github.com/fastify/fastify#team.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t8"></a>T8: MIT (4 packages)

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t9"></a>T9: OFL-1.1 (2 packages)

```text
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### <a id="t10"></a>T10: (CC-BY-4.0 AND MIT), MIT (4 packages)

```text
Fonticons, Inc. (https://fontawesome.com)

--------------------------------------------------------------------------------

Font Awesome Free License

Font Awesome Free is free, open source, and GPL friendly. You can use it for
commercial projects, open source projects, or really almost whatever you want.
Full Font Awesome Free license: https://fontawesome.com/license/free.

--------------------------------------------------------------------------------

# Icons: CC BY 4.0 License (https://creativecommons.org/licenses/by/4.0/)

The Font Awesome Free download is licensed under a Creative Commons
Attribution 4.0 International License and applies to all icons packaged
as SVG and JS file types.

--------------------------------------------------------------------------------

# Fonts: SIL OFL 1.1 License

In the Font Awesome Free download, the SIL OFL license applies to all icons
packaged as web and desktop font files.

with Reserved Font Name: "Font Awesome".

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

SIL OPEN FONT LICENSE
Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting — in part or in whole — any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

--------------------------------------------------------------------------------

# Code: MIT License (https://opensource.org/licenses/MIT)

In the Font Awesome Free download, the MIT license applies to all non-font and
non-icon files.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

--------------------------------------------------------------------------------

# Attribution

Attribution is required by MIT, SIL OFL, and CC BY licenses. Downloaded Font
Awesome Free files already contain embedded comments with sufficient
attribution, so you shouldn't need to do anything additional when using these
files normally.

We've kept attribution comments terse, so we ask that you do not actively work
to remove them from files, especially code. They're a great way for folks to
learn about Font Awesome.

--------------------------------------------------------------------------------

# Brand Icons

All brand icons are trademarks of their respective owners. The use of these
trademarks does not indicate endorsement of the trademark holder by Font
Awesome, nor vice versa. **Please do not use brand logos for any purpose except
to represent the company, product, or service to which they refer.**
```

### <a id="t11"></a>T11: BSD-3-Clause (6 packages)

```text
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * The names of any contributors may not be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t12"></a>T12: BSD-3-Clause (3 packages)

```text
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* The names of any contributors may not be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS OFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t13"></a>T13: ISC (19 packages)

```text
Permission to use, copy, modify, and/or distribute this software
for any purpose with or without fee is hereby granted, provided
that the above copyright notice and this permission notice
appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE
LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t14"></a>T14: BlueOak-1.0.0 (6 packages)

```text
# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules.  The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice.  If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

***As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim.***
```

### <a id="t15"></a>T15: MIT (68 packages)

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t16"></a>T16: MIT (55 packages)

```text
MIT License

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE
```

### <a id="t17"></a>T17: MIT (1 package)

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t18"></a>T18: MIT (142 packages)

```text
(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t19"></a>T19: MIT (16 packages)

```text
The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### <a id="t20"></a>T20: MIT (5 packages)

```text
MIT License Copyright (c) 2019 Octokit contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice (including the next paragraph) shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t21"></a>T21: MIT (1 package)

```text
MIT License Copyright (c) 2020 Octokit contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice (including the next paragraph) shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t22"></a>T22: Apache-2.0 (3 packages)

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Portions Copyright (c) Microsoft Corporation.
   Portions Copyright 2017 Google Inc.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### <a id="t23"></a>T23: BSD-3-Clause (10 packages)

```text
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of its author, nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t24"></a>T24: MIT (1 package)

```text
TypeBox: JSON Schema Type Builder with Static Type Resolution for TypeScript

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### <a id="t25"></a>T25: MIT (1 package)

```text
All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t26"></a>T26: ISC (8 packages)

```text
ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t27"></a>T27: Apache-2.0 (1 package)

```text
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### <a id="t28"></a>T28: ISC (19 packages)

```text
The ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t29"></a>T29: Python-2.0 (1 package)

```text
A. HISTORY OF THE SOFTWARE
==========================

Python was created in the early 1990s by Guido van Rossum at Stichting
Mathematisch Centrum (CWI, see http://www.cwi.nl) in the Netherlands
as a successor of a language called ABC.  Guido remains Python's
principal author, although it includes many contributions from others.

In 1995, Guido continued his work on Python at the Corporation for
National Research Initiatives (CNRI, see http://www.cnri.reston.va.us)
in Reston, Virginia where he released several versions of the
software.

In May 2000, Guido and the Python core development team moved to
BeOpen.com to form the BeOpen PythonLabs team.  In October of the same
year, the PythonLabs team moved to Digital Creations, which became
Zope Corporation.  In 2001, the Python Software Foundation (PSF, see
https://www.python.org/psf/) was formed, a non-profit organization
created specifically to own Python-related Intellectual Property.
Zope Corporation was a sponsoring member of the PSF.

All Python releases are Open Source (see http://www.opensource.org for
the Open Source Definition).  Historically, most, but not all, Python
releases have also been GPL-compatible; the table below summarizes
the various releases.

    Release         Derived     Year        Owner       GPL-
                    from                                compatible? (1)

    0.9.0 thru 1.2              1991-1995   CWI         yes
    1.3 thru 1.5.2  1.2         1995-1999   CNRI        yes
    1.6             1.5.2       2000        CNRI        no
    2.0             1.6         2000        BeOpen.com  no
    1.6.1           1.6         2001        CNRI        yes (2)
    2.1             2.0+1.6.1   2001        PSF         no
    2.0.1           2.0+1.6.1   2001        PSF         yes
    2.1.1           2.1+2.0.1   2001        PSF         yes
    2.1.2           2.1.1       2002        PSF         yes
    2.1.3           2.1.2       2002        PSF         yes
    2.2 and above   2.1.1       2001-now    PSF         yes

Footnotes:

(1) GPL-compatible doesn't mean that we're distributing Python under
    the GPL.  All Python licenses, unlike the GPL, let you distribute
    a modified version without making your changes open source.  The
    GPL-compatible licenses make it possible to combine Python with
    other software that is released under the GPL; the others don't.

(2) According to Richard Stallman, 1.6.1 is not GPL-compatible,
    because its license has a choice of law clause.  According to
    CNRI, however, Stallman's lawyer has told CNRI's lawyer that 1.6.1
    is "not incompatible" with the GPL.

Thanks to the many outside volunteers who have worked under Guido's
direction to make these releases possible.

B. TERMS AND CONDITIONS FOR ACCESSING OR OTHERWISE USING PYTHON
===============================================================

PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2
--------------------------------------------

1. This LICENSE AGREEMENT is between the Python Software Foundation
("PSF"), and the Individual or Organization ("Licensee") accessing and
otherwise using this software ("Python") in source or binary form and
its associated documentation.

2. Subject to the terms and conditions of this License Agreement, PSF hereby
grants Licensee a nonexclusive, royalty-free, world-wide license to reproduce,
analyze, test, perform and/or display publicly, prepare derivative works,
distribute, and otherwise use Python alone or in any derivative version,
provided, however, that PSF's License Agreement and PSF's notice of copyright,
i.e., "Copyright (c) 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010,
2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020 Python Software Foundation;
All Rights Reserved" are retained in Python alone or in any derivative version
prepared by Licensee.

3. In the event Licensee prepares a derivative work that is based on
or incorporates Python or any part thereof, and wants to make
the derivative work available to others as provided herein, then
Licensee hereby agrees to include in any such work a brief summary of
the changes made to Python.

4. PSF is making Python available to Licensee on an "AS IS"
basis.  PSF MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PSF MAKES NO AND
DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS
FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF PYTHON WILL NOT
INFRINGE ANY THIRD PARTY RIGHTS.

5. PSF SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF PYTHON
FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS
A RESULT OF MODIFYING, DISTRIBUTING, OR OTHERWISE USING PYTHON,
OR ANY DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

6. This License Agreement will automatically terminate upon a material
breach of its terms and conditions.

7. Nothing in this License Agreement shall be deemed to create any
relationship of agency, partnership, or joint venture between PSF and
Licensee.  This License Agreement does not grant permission to use PSF
trademarks or trade name in a trademark sense to endorse or promote
products or services of Licensee, or any third party.

8. By copying, installing or otherwise using Python, Licensee
agrees to be bound by the terms and conditions of this License
Agreement.

BEOPEN.COM LICENSE AGREEMENT FOR PYTHON 2.0
-------------------------------------------

BEOPEN PYTHON OPEN SOURCE LICENSE AGREEMENT VERSION 1

1. This LICENSE AGREEMENT is between BeOpen.com ("BeOpen"), having an
office at 160 Saratoga Avenue, Santa Clara, CA 95051, and the
Individual or Organization ("Licensee") accessing and otherwise using
this software in source or binary form and its associated
documentation ("the Software").

2. Subject to the terms and conditions of this BeOpen Python License
Agreement, BeOpen hereby grants Licensee a non-exclusive,
royalty-free, world-wide license to reproduce, analyze, test, perform
and/or display publicly, prepare derivative works, distribute, and
otherwise use the Software alone or in any derivative version,
provided, however, that the BeOpen Python License is retained in the
Software, alone or in any derivative version prepared by Licensee.

3. BeOpen is making the Software available to Licensee on an "AS IS"
basis.  BEOPEN MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, BEOPEN MAKES NO AND
DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS
FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE SOFTWARE WILL NOT
INFRINGE ANY THIRD PARTY RIGHTS.

4. BEOPEN SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF THE
SOFTWARE FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS
AS A RESULT OF USING, MODIFYING OR DISTRIBUTING THE SOFTWARE, OR ANY
DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

5. This License Agreement will automatically terminate upon a material
breach of its terms and conditions.

6. This License Agreement shall be governed by and interpreted in all
respects by the law of the State of California, excluding conflict of
law provisions.  Nothing in this License Agreement shall be deemed to
create any relationship of agency, partnership, or joint venture
between BeOpen and Licensee.  This License Agreement does not grant
permission to use BeOpen trademarks or trade names in a trademark
sense to endorse or promote products or services of Licensee, or any
third party.  As an exception, the "BeOpen Python" logos available at
http://www.pythonlabs.com/logos.html may be used according to the
permissions granted on that web page.

7. By copying, installing or otherwise using the software, Licensee
agrees to be bound by the terms and conditions of this License
Agreement.

CNRI LICENSE AGREEMENT FOR PYTHON 1.6.1
---------------------------------------

1. This LICENSE AGREEMENT is between the Corporation for National
Research Initiatives, having an office at 1895 Preston White Drive,
Reston, VA 20191 ("CNRI"), and the Individual or Organization
("Licensee") accessing and otherwise using Python 1.6.1 software in
source or binary form and its associated documentation.

2. Subject to the terms and conditions of this License Agreement, CNRI
hereby grants Licensee a nonexclusive, royalty-free, world-wide
license to reproduce, analyze, test, perform and/or display publicly,
prepare derivative works, distribute, and otherwise use Python 1.6.1
alone or in any derivative version, provided, however, that CNRI's
License Agreement and CNRI's notice of copyright, i.e., "Copyright (c)
1995-2001 Corporation for National Research Initiatives; All Rights
Reserved" are retained in Python 1.6.1 alone or in any derivative
version prepared by Licensee.  Alternately, in lieu of CNRI's License
Agreement, Licensee may substitute the following text (omitting the
quotes): "Python 1.6.1 is made available subject to the terms and
conditions in CNRI's License Agreement.  This Agreement together with
Python 1.6.1 may be located on the Internet using the following
unique, persistent identifier (known as a handle): 1895.22/1013.  This
Agreement may also be obtained from a proxy server on the Internet
using the following URL: http://hdl.handle.net/1895.22/1013".

3. In the event Licensee prepares a derivative work that is based on
or incorporates Python 1.6.1 or any part thereof, and wants to make
the derivative work available to others as provided herein, then
Licensee hereby agrees to include in any such work a brief summary of
the changes made to Python 1.6.1.

4. CNRI is making Python 1.6.1 available to Licensee on an "AS IS"
basis.  CNRI MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, CNRI MAKES NO AND
DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS
FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF PYTHON 1.6.1 WILL NOT
INFRINGE ANY THIRD PARTY RIGHTS.

5. CNRI SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF PYTHON
1.6.1 FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS
A RESULT OF MODIFYING, DISTRIBUTING, OR OTHERWISE USING PYTHON 1.6.1,
OR ANY DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

6. This License Agreement will automatically terminate upon a material
breach of its terms and conditions.

7. This License Agreement shall be governed by the federal
intellectual property law of the United States, including without
limitation the federal copyright law, and, to the extent such
U.S. federal law does not apply, by the law of the Commonwealth of
Virginia, excluding Virginia's conflict of law provisions.
Notwithstanding the foregoing, with regard to derivative works based
on Python 1.6.1 that incorporate non-separable material that was
previously distributed under the GNU General Public License (GPL), the
law of the Commonwealth of Virginia shall govern this License
Agreement only as to issues arising under or with respect to
Paragraphs 4, 5, and 7 of this License Agreement.  Nothing in this
License Agreement shall be deemed to create any relationship of
agency, partnership, or joint venture between CNRI and Licensee.  This
License Agreement does not grant permission to use CNRI trademarks or
trade name in a trademark sense to endorse or promote products or
services of Licensee, or any third party.

8. By clicking on the "ACCEPT" button where indicated, or by copying,
installing or otherwise using Python 1.6.1, Licensee agrees to be
bound by the terms and conditions of this License Agreement.

        ACCEPT

CWI LICENSE AGREEMENT FOR PYTHON 0.9.0 THROUGH 1.2
--------------------------------------------------

The Netherlands.  All rights reserved.

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose and without fee is hereby granted,
provided that the above copyright notice appear in all copies and that
both that copyright notice and this permission notice appear in
supporting documentation, and that the name of Stichting Mathematisch
Centrum or CWI not be used in advertising or publicity pertaining to
distribution of the software without specific, written prior
permission.

STICHTING MATHEMATISCH CENTRUM DISCLAIMS ALL WARRANTIES WITH REGARD TO
THIS SOFTWARE, INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS, IN NO EVENT SHALL STICHTING MATHEMATISCH CENTRUM BE LIABLE
FOR ANY SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t30"></a>T30: MIT (2 packages)

```text
# Copyright (c) 2014-present Matt Zabriskie & Collaborators

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t31"></a>T31: MIT (1 package)

```text
(MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t32"></a>T32: MIT (1 package)

```text
(MIT)

Original code Copyright Julian Gruber <julian@juliangruber.com>

Port to TypeScript Copyright Isaac Z. Schlueter <i@izs.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t33"></a>T33: MIT (1 package)

```text
The MIT License (MIT)
=====================

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the “Software”), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t34"></a>T34: MIT (21 packages)

```text
The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t35"></a>T35: MIT (1 package)

```text
All rights reserved.

MIT License

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

Distributions of all or part of the Software intended to be used
by the recipients as they would use the unmodified Software,
containing modifications that substantially alter, remove, or
disable functionality of the Software, outside of the documented
configuration mechanisms provided by the Software, shall be
modified such that the Original Author's bug reporting email
addresses and urls are either replaced with the contact information
of the parties responsible for the changes, or removed entirely.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

Except where noted, this license applies to any and all software
programs and associated documentation files created by the
Original Author, when distributed with the Software.
```

### <a id="t36"></a>T36: MIT (1 package)

```text
MIT License

TypeScript port Copyright Isaac Z. Schlueter <i@izs.me>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t37"></a>T37: BSD-3-Clause (1 package)

```text
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

* Neither the name of salesforce.com, nor GoInstant, nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t38"></a>T38: MIT (4 packages)

```text
The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### <a id="t39"></a>T39: MIT (5 packages)

```text
MIT License
-----------

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t40"></a>T40: Apache-2.0 (1 package)

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### <a id="t41"></a>T41: Apache-2.0 (2 packages)

```text
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this library except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### <a id="t42"></a>T42: MIT (1 package)

```text
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t43"></a>T43: MIT (1 package)

```text
MIT License

Maël Nison <nison.mael@gmail.com>
Paul Soporan <paul.soporan@gmail.com>
Pooya Parsa <pyapar@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t44"></a>T44: BSD-3-Clause (1 package)

```text
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t45"></a>T45: MIT (1 package)

```text
The MIT Expat Licence.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t46"></a>T46: MIT (1 package)

```text
# MIT License

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t47"></a>T47: BSD-3-Clause (1 package)

```text
// Copyright 2014 The Chromium Authors. All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google Inc. nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t48"></a>T48: Apache-2.0 (1 package)

```text
## License

didYouMean.js copyright (c) 2013 Dave Porter.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License
[here](http://www.apache.org/licenses/LICENSE-2.0).

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### <a id="t49"></a>T49: BSD-3-Clause (1 package)

```text
Software License Agreement (BSD License)

All rights reserved.

Redistribution and use of this software in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above
  following disclaimer.

* Redistributions in binary form must reproduce the above
  following disclaimer in the documentation and/or other
  materials provided with the distribution.

* Neither the name of Kevin Decker nor the names of its
  contributors may be used to endorse or promote products
  derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t50"></a>T50: BSD-2-Clause (4 packages)

```text
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t51"></a>T51: BSD-3-Clause (1 package)

```text
======================================
All rights reserved.
--------------------

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. Neither the name of Deoxxa Development nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY DEOXXA DEVELOPMENT ''AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL DEOXXA DEVELOPMENT BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t52"></a>T52: MIT (1 package)

```text
MIT

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t53"></a>T53: BSD-3-Clause (1 package)

```text
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

                                  *   *   *

The complete list of contributors can be found at:
- https://github.com/garycourt/uri-js/graphs/contributors
```

### <a id="t54"></a>T54: ISC (4 packages)

```text
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t55"></a>T55: ISC (1 package)

```text
ISC License (ISC)

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t56"></a>T56: BlueOak-1.0.0 (2 packages)

```text
All packages under `src/` are licensed according to the terms in
their respective `LICENSE` or `LICENSE.md` files.

The remainder of this project is licensed under the Blue Oak
Model License, as follows:

-----

# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules.  The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice.  If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

***As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim.***
```

### <a id="t57"></a>T57: (MIT AND Zlib), MIT (10 packages)

```text
(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### <a id="t58"></a>T58: BSD-3-Clause (3 packages)

```text
Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t59"></a>T59: BlueOak-1.0.0 (2 packages)

```text
# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules. The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice. If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

**_As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim._**
```

### <a id="t60"></a>T60: BSD-2-Clause (1 package)

```text
BSD 2-Clause License

Original source code is copyright (c) 2019-2025 Remy Rylan
<https://github.com/RemyRylan>

All JSON Schema documentation and descriptions are copyright (c):

2009 [draft-0] IETF Trust <https://www.ietf.org/>, Kris Zyp <kris@sitepen.com>,
and SitePen (USA) <https://www.sitepen.com/>.

2009 [draft-1] IETF Trust <https://www.ietf.org/>, Kris Zyp <kris@sitepen.com>,
and SitePen (USA) <https://www.sitepen.com/>.

2010 [draft-2] IETF Trust <https://www.ietf.org/>, Kris Zyp <kris@sitepen.com>,
and SitePen (USA) <https://www.sitepen.com/>.

2010 [draft-3] IETF Trust <https://www.ietf.org/>, Kris Zyp <kris@sitepen.com>,
Gary Court <gary.court@gmail.com>, and SitePen (USA) <https://www.sitepen.com/>.

2013 [draft-4] IETF Trust <https://www.ietf.org/>), Francis Galiegue
<fgaliegue@gmail.com>, Kris Zyp <kris@sitepen.com>, Gary Court
<gary.court@gmail.com>, and SitePen (USA) <https://www.sitepen.com/>.

2018 [draft-7] IETF Trust <https://www.ietf.org/>, Austin Wright <aaa@bzfx.net>,
Henry Andrews <henry@cloudflare.com>, Geraint Luff <luffgd@gmail.com>, and
Cloudflare, Inc. <https://www.cloudflare.com/>.

2019 [draft-2019-09] IETF Trust <https://www.ietf.org/>, Austin Wright
<aaa@bzfx.net>, Henry Andrews <andrews_henry@yahoo.com>, Ben Hutton
<bh7@sanger.ac.uk>, and Greg Dennis <gregsdennis@yahoo.com>.

2020 [draft-2020-12] IETF Trust <https://www.ietf.org/>, Austin Wright
<aaa@bzfx.net>, Henry Andrews <andrews_henry@yahoo.com>, Ben Hutton
<ben@jsonschema.dev>, and Greg Dennis <gregsdennis@yahoo.com>.

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t61"></a>T61: MIT (1 package)

```text
MIT License

Robert Krahn, Brett Zamir, Richard Schneider

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t62"></a>T62: BSD-3-Clause (2 packages)

```text
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

                                  *   *   *

The complete list of contributors can be found at:
- https://github.com/hapijs/shot/graphs/contributors
- https://github.com/fastify/light-my-request/graphs/contributors
```

### <a id="t63"></a>T63: MIT (8 packages)

```text
Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

====

code is defined as all source code displayed within the prose of the
documentation.

CC0: http://creativecommons.org/publicdomain/zero/1.0/

====

Files located in the node_modules and vendor directories are externally
maintained libraries used by this software which have their own
licenses; we recommend you read them, as their terms may differ from the
terms above.
```

### <a id="t64"></a>T64: MIT (3 packages)

```text
Based on Underscore.js, copyright 2009-2016 Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t65"></a>T65: MIT (2 packages)

```text
This software is released under the MIT license:

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t66"></a>T66: MIT (1 package)

```text
MIT License

Based on Async.js, Copyright Caolan McMahon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t67"></a>T67: Apache-2.0 (1 package)

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```

### <a id="t68"></a>T68: MIT-0 (1 package)

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t69"></a>T69: MIT (1 package)

```text
The MIT License (Expat)

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation files
(the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software,
and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### <a id="t70"></a>T70: ISC (1 package)

```text
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above

THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t71"></a>T71: MIT (1 package)

```text
# Copyright (c) 2015 Calvin Metcalf

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

**THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.**
```

### <a id="t72"></a>T72: BSD-3-Clause (2 packages)

```text
This license applies to all parts of protobuf.js except those files
either explicitly including or referencing a different license or
located in a directory containing a different LICENSE file.

---

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of its author, nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

Code generated by the command line utilities is owned by the owner
of the input file used when generating it. This code is not
standalone and requires a support library to be linked with it. This
support library is itself covered by the above license.
```

### <a id="t73"></a>T73: MIT (1 package)

```text
The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t74"></a>T74: BSD-3-Clause (2 packages)

```text
BSD 3-Clause License

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t75"></a>T75: MIT (1 package)

```text
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---
Icons are taken from the other projects
so please check each project licences accordingly.

Circum Icons - https://circumicons.com/
License: MPL-2.0 license https://github.com/Klarr-Agency/Circum-Icons/blob/main/LICENSE

Font Awesome 5 - https://fontawesome.com/
License: CC BY 4.0 License https://creativecommons.org/licenses/by/4.0/

Font Awesome 6 - https://fontawesome.com/
License: CC BY 4.0 License https://creativecommons.org/licenses/by/4.0/

Ionicons 4 - https://ionicons.com/
License: MIT https://github.com/ionic-team/ionicons/blob/master/LICENSE

Ionicons 5 - https://ionicons.com/
License: MIT https://github.com/ionic-team/ionicons/blob/master/LICENSE

Material Design icons - http://google.github.io/material-design-icons/
License: Apache License Version 2.0 https://github.com/google/material-design-icons/blob/master/LICENSE

Typicons - http://s-ings.com/typicons/
License: CC BY-SA 3.0 https://creativecommons.org/licenses/by-sa/3.0/

Github Octicons icons - https://octicons.github.com/
License: MIT https://github.com/primer/octicons/blob/master/LICENSE

Feather - https://feathericons.com/
License: MIT https://github.com/feathericons/feather/blob/master/LICENSE

Lucide - https://lucide.dev/
License: ISC https://github.com/lucide-icons/lucide/blob/main/LICENSE

Game Icons - https://game-icons.net/
License: CC BY 3.0 https://creativecommons.org/licenses/by/3.0/

Weather Icons - https://erikflowers.github.io/weather-icons/
License: SIL OFL 1.1 http://scripts.sil.org/OFL

Devicons - https://vorillaz.github.io/devicons/
License: MIT https://opensource.org/licenses/MIT

Ant Design Icons - https://github.com/ant-design/ant-design-icons
License: MIT https://opensource.org/licenses/MIT

Bootstrap Icons - https://github.com/twbs/icons
License: MIT https://opensource.org/licenses/MIT

Remix Icon - https://github.com/Remix-Design/RemixIcon
License: Apache License Version 2.0 http://www.apache.org/licenses/

Flat Color Icons - https://github.com/icons8/flat-color-icons
License: MIT https://opensource.org/licenses/MIT

Grommet-Icons - https://github.com/grommet/grommet-icons
License: Apache License Version 2.0 http://www.apache.org/licenses/

Heroicons - https://github.com/tailwindlabs/heroicons
License: MIT https://opensource.org/licenses/MIT

Heroicons 2 - https://github.com/tailwindlabs/heroicons
License: MIT https://opensource.org/licenses/MIT

Simple Icons - https://simpleicons.org/
License: CC0 1.0 Universal https://creativecommons.org/publicdomain/zero/1.0/

Simple Line Icons - https://thesabbir.github.io/simple-line-icons/
License: MIT https://opensource.org/licenses/MIT

IcoMoon Free - https://github.com/Keyamoon/IcoMoon-Free
License: CC BY 4.0 License https://github.com/Keyamoon/IcoMoon-Free/blob/master/License.txt

BoxIcons - https://github.com/atisawd/boxicons
License: MIT https://github.com/atisawd/boxicons/blob/master/LICENSE

css.gg - https://github.com/astrit/css.gg
License: MIT https://opensource.org/licenses/MIT

VS Code Icons - https://github.com/microsoft/vscode-codicons
License: CC BY 4.0 https://creativecommons.org/licenses/by/4.0/

Tabler Icons - https://github.com/tabler/tabler-icons
License: MIT https://opensource.org/licenses/MIT

Themify Icons - https://github.com/lykmapipo/themify-icons
License: MIT https://github.com/thecreation/standard-icons/blob/master/modules/themify-icons/LICENSE

Radix Icons - https://icons.radix-ui.com
License: MIT https://github.com/radix-ui/icons/blob/master/LICENSE

Phosphor Icons - https://github.com/phosphor-icons/core
License: MIT https://github.com/phosphor-icons/core/blob/main/LICENSE

Icons8 Line Awesome - https://icons8.com/line-awesome
License: MIT https://github.com/icons8/line-awesome/blob/master/LICENSE.md
```

### <a id="t76"></a>T76: BSD-3-Clause (1 package)

```text
BSD 3-Clause License

Forked from React (https://github.com/facebook/react) Copyright 2013-present, Facebook, Inc.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t77"></a>T77: MIT (6 packages)

```text
Node.js is licensed for use as follows:

"""

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
"""

This license applies to parts of Node.js originating from the
https://github.com/joyent/node repository:

"""
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
"""
```

### <a id="t78"></a>T78: Apache-2.0 (2 packages)

```text
Apache License

Version 2.0, January 2004

http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications, including but not limited to software source code, documentation source, and configuration files.

"Object" form shall mean any form resulting from mechanical transformation or translation of a Source form, including but not limited to compiled object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form, made available under the License, as indicated by a copyright notice that is included in or attached to the work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form, that is based on (or derived from) the Work and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship. For the purposes of this License, Derivative Works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including the original version of the Work and any modifications or additions to that Work or Derivative Works thereof, that is intentionally submitted to Licensor for inclusion in the Work by the copyright owner or by an individual or Legal Entity authorized to submit on behalf of the copyright owner. For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to the Licensor or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, the Licensor for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on behalf of whom a Contribution has been received by Licensor and subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) alone or by combination of their Contribution(s) with the Work to which such Contribution(s) was submitted. If You institute patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions:

You must give any other recipients of the Work or Derivative Works a copy of this License; and

You must cause any modified files to carry prominent notices stating that You changed the files; and

You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the Source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and

If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file, excluding those notices that do not pertain to any part of the Derivative Works, in at least one of the following places: within a NOTICE text file distributed as part of the Derivative Works; within the Source form or documentation, if provided along with the Derivative Works; or, within a display generated by the Derivative Works, if and wherever such third-party notices normally appear. The contents of the NOTICE file are for informational purposes only and do not modify the License. You may add Your own attribution notices within Derivative Works that You distribute, alongside or as an addendum to the NOTICE text from the Work, provided that such additional attribution notices cannot be construed as modifying the License. You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions. Notwithstanding the above, nothing herein shall supersede or modify the terms of any separate license agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or agreed to in writing, shall any Contributor be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this License or out of the use or inability to use the Work (including but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or any and all other commercial damages or losses), even if such Contributor has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty, indemnity, or other liability obligations and/or rights consistent with this License. However, in accepting such obligations, You may act only on Your own behalf and on Your sole responsibility, not on behalf of any other Contributor, and only if You agree to indemnify, defend, and hold each Contributor harmless for any liability incurred by, or claims asserted against, such Contributor by reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

### <a id="t79"></a>T79: MIT OR SEE LICENSE IN FEEL-FREE.md (1 package)

```text
Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Exemptions
==========

Please either apply this, the MIT license, or the license in './FEEL-FREE.md'
```

### <a id="t80"></a>T80: BSD-3-Clause (1 package)

```text
All rights reserved.

The Fastify team members are listed at https://github.com/fastify/fastify#team.

The complete list of contributors can be found at:
- https://github.com/hapijs/bourne/graphs/contributors
- https://github.com/fastify/secure-json-parse/graphs/contributors

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t81"></a>T81: BSD-3-Clause (1 package)

```text
All rights reserved.

The complete list of contributors can be found at:
- https://github.com/hapijs/bourne/graphs/contributors
- https://github.com/fastify/secure-json-parse/graphs/contributors

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t82"></a>T82: (MIT AND BSD-3-Clause) (1 package)

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

Neither the name of the author nor the names of its contributors may be used to
endorse or promote products derived from this software without specific prior
written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t83"></a>T83: ISC (1 package)

```text
The ISC License

Permission to use, copy, modify, and/or distribute this software
for any purpose with or without fee is hereby granted, provided
that the above copyright notice and this permission notice
appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE
LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t84"></a>T84: BSD-3-Clause (2 packages)

```text
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the names of the Mozilla Foundation nor the names of project
  contributors may be used to endorse or promote products derived from this
  software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t85"></a>T85: MIT (1 package)

```text
# The MIT License (MIT)

**Copyright (c) Rod Vagg (the "Original Author") and additional contributors**

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t86"></a>T86: 0BSD (2 packages)

```text
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t87"></a>T87: BSD-2-Clause (1 package)

```text
UglifyJS is released under the BSD license:

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

    * Redistributions of source code must retain the above
      disclaimer.

    * Redistributions in binary form must reproduce the above
      disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
SUCH DAMAGE.
```

### <a id="t88"></a>T88: MIT (1 package)

```text
(The MIT license)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t89"></a>T89: ISC (1 package)

```text
# [ISC License](https://spdx.org/licenses/ISC)

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### <a id="t90"></a>T90: MIT (1 package)

```text
(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the 'Software'), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### <a id="t91"></a>T91: MIT (1 package)

```text
Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

Commits in this fork are (c) Ziggy Jonsson (ziggy.jonsson.nyc@gmail.com)
and fall under same licence structure as the original repo (MIT)
```

### <a id="t92"></a>T92: Apache-2.0 (1 package)

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       https://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### <a id="t93"></a>T93: BSD-2-Clause (1 package)

```text
# The BSD 2-Clause License

All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### <a id="t94"></a>T94: MIT (1 package)

```text
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
