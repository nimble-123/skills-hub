# Changelog

## [0.4.0](https://github.com/nimble-123/skills-hub/compare/v0.3.1...v0.4.0) (2026-09-28)


### Features

* **ui:** eighteen palettes and nine typefaces to choose between ([#17](https://github.com/nimble-123/skills-hub/issues/17)) ([314b1bc](https://github.com/nimble-123/skills-hub/commit/314b1bc38b4b17bba91b2ced2b6d5be0d422dbf8))
* **ui:** give each item type its own muted colour ([#12](https://github.com/nimble-123/skills-hub/issues/12)) ([9c2626c](https://github.com/nimble-123/skills-hub/commit/9c2626c44ce367eda5f4e3fc02ccc43a574be498))
* **ui:** rebuild the cost page against the plugin's dashboard ([#16](https://github.com/nimble-123/skills-hub/issues/16)) ([9259044](https://github.com/nimble-123/skills-hub/commit/92590441298188b97063da81845e4df2c8150571))


### Fixes

* **ui:** one corner radius for the tag chips ([#19](https://github.com/nimble-123/skills-hub/issues/19)) ([71618cf](https://github.com/nimble-123/skills-hub/commit/71618cf7d7863b5316674053e245e486cb6cb20a))
* **ui:** use the real Claude and Gemini marks ([#15](https://github.com/nimble-123/skills-hub/issues/15)) ([e9c3440](https://github.com/nimble-123/skills-hub/commit/e9c34409c5d74fbbfd5fa4761d8ab95cd3463e3c))


### Documentation

* add CLAUDE.md ([#21](https://github.com/nimble-123/skills-hub/issues/21)) ([d1fbef6](https://github.com/nimble-123/skills-hub/commit/d1fbef6967b56480c12360f155a6d444d9bb5fd9))
* bring plan.md and CONTRIBUTING.md up to date with the repository ([#20](https://github.com/nimble-123/skills-hub/issues/20)) ([0a06df4](https://github.com/nimble-123/skills-hub/commit/0a06df4bc0b5f12f6f0d86e90453b4ba03715647))
* correct the macOS Gatekeeper advice ([#13](https://github.com/nimble-123/skills-hub/issues/13)) ([8ceb759](https://github.com/nimble-123/skills-hub/commit/8ceb759e9c7bd7c9dd36ecbdf541d58dab7ab643))
* drop the UI5 Web Components idea ([#23](https://github.com/nimble-123/skills-hub/issues/23)) ([2bc2962](https://github.com/nimble-123/skills-hub/commit/2bc2962c878f1c9e8fa375f1d8fd074eb3ffc1a5))
* rebuild the product page around the screenshots ([#18](https://github.com/nimble-123/skills-hub/issues/18)) ([c287e05](https://github.com/nimble-123/skills-hub/commit/c287e05ffb4e7fbafccdf0e650ff7a4a54c78770))
* write down the architecture, the guarantees, and the procedures ([#22](https://github.com/nimble-123/skills-hub/issues/22)) ([f2255e2](https://github.com/nimble-123/skills-hub/commit/f2255e228688fdb8fea4270b330939ff2235f968))

## [0.3.1](https://github.com/nimble-123/skills-hub/compare/v0.3.0...v0.3.1) (2026-09-28)


### Fixes

* **ci:** publish releases directly instead of holding them as drafts ([6c271c9](https://github.com/nimble-123/skills-hub/commit/6c271c9df889e109e8545ba17001a4432b75bff3))
* **ci:** push the Cargo.lock sync under the release token too ([a048f6c](https://github.com/nimble-123/skills-hub/commit/a048f6c789e2c77654391435a8bb80ccb9e9dbaf))

## [0.3.0](https://github.com/nimble-123/skills-hub/compare/v0.2.0...v0.3.0) (2026-09-28)


### Features

* cost, usage, MCP servers, collections and plugin bundles ([dc0d7fe](https://github.com/nimble-123/skills-hub/commit/dc0d7fe7333b0cdf50e8173a0ec0e36ce1a65d2c))
* discover, install, update and restore ([212f81a](https://github.com/nimble-123/skills-hub/commit/212f81a7a0ec540f65711c9cae135e4fbc8a32f4))
* **discover:** search the skills.sh registry to find repositories ([7d7155a](https://github.com/nimble-123/skills-hub/commit/7d7155ab97b44777a57243aad6427ac011355234))
* rescan pipeline and the command surface ([ff8b853](https://github.com/nimble-123/skills-hub/commit/ff8b853dea93987c2ddb65a8c91deebaf8385fbc))
* scaffold skills-hub and implement the scanner ([94aaf16](https://github.com/nimble-123/skills-hub/commit/94aaf1653b33317032bbb67c29c6fe6417064796))
* settings as an overlay, and enable/disable that cannot lose files ([c7f3aa5](https://github.com/nimble-123/skills-hub/commit/c7f3aa5c894914e0f03967756ce723ce226798f3))
* **store:** metadata notes that cannot lose the user's work ([461bc21](https://github.com/nimble-123/skills-hub/commit/461bc2186bcbf676303c35d5b8d82c082be0f651))
* **tools:** make the tools page editable ([6d4b852](https://github.com/nimble-123/skills-hub/commit/6d4b852af38f80d597dbcb315fa0031e0b74bbf3))
* **ui:** detail rail, keyboard, project workspaces ([016523b](https://github.com/nimble-123/skills-hub/commit/016523be4d28ac1ecd7575ebea819dc4d87caadd))
* **ui:** edit an item's file, and finish phase one ([ebc9e99](https://github.com/nimble-123/skills-hub/commit/ebc9e994e5ff195a1c4c709f03f7892cab9da6f0))
* **ui:** the library window ([6673481](https://github.com/nimble-123/skills-hub/commit/667348173d17d557007b5cfe215524b12352e171))
* **ui:** the missing pages, a wider rail, and highlighted code ([e9968a7](https://github.com/nimble-123/skills-hub/commit/e9968a7c7b70ee4133320eced613b0c48d9a8fd9))


### Fixes

* **ci:** cut the release ourselves instead of via release-please ([3b2549a](https://github.com/nimble-123/skills-hub/commit/3b2549a4965ee2d44ffc7c40be6a99ab9d13e10f))
* **ci:** do not check out a tag that does not exist yet ([#3](https://github.com/nimble-123/skills-hub/issues/3)) ([9c6be5a](https://github.com/nimble-123/skills-hub/commit/9c6be5abecfc0c060241f38d0d76c322c102ee42))
* **ci:** read the release branch from release-please's own output ([e4064a4](https://github.com/nimble-123/skills-hub/commit/e4064a4ebec928c1107d53d4560cff0c4a8214d3))
* **ci:** the token probe was not valid YAML ([#7](https://github.com/nimble-123/skills-hub/issues/7)) ([b96572f](https://github.com/nimble-123/skills-hub/commit/b96572fc6adbff01618bf5a6c955859bd34b570f))


### Performance

* **ci:** build verification bundles with a cheaper profile ([33edb34](https://github.com/nimble-123/skills-hub/commit/33edb34a4bae2195eaf4d85d61bb143676c083ce))


### Documentation

* correct what happens to checks on the release PR ([09ce146](https://github.com/nimble-123/skills-hub/commit/09ce146788d2a3d9a0c8af0fec3b69d427b4ff83))
* drop the note about this checkout's filesystem from the README ([067a34d](https://github.com/nimble-123/skills-hub/commit/067a34d9aef4a40fe5f7c58639c17a76ee5c8fc6))
* keep the open points in plan.md ([6779721](https://github.com/nimble-123/skills-hub/commit/677972188169a6e076bdf7d533213042b50f5219))
* let the product page follow an explicit theme choice ([c972110](https://github.com/nimble-123/skills-hub/commit/c9721108c79b2126467304946f18824083f37d50))
* record what the CI profile change actually bought ([8bab09b](https://github.com/nimble-123/skills-hub/commit/8bab09bfa2a7541fff2a9e75008f0c2320fd8d07))
* screenshots, a rewritten README, and a product page ([fe6a031](https://github.com/nimble-123/skills-hub/commit/fe6a03118e8a09d51b2054048e2b4bc591925ae3))
* stage branch protection, and say why step two has to wait ([940a44d](https://github.com/nimble-123/skills-hub/commit/940a44dd357e10f733d7d9d26430fed91607c3e9))


### Build

* settle tauri.conf.json into release-please's formatting ([e584fda](https://github.com/nimble-123/skills-hub/commit/e584fda0236900ed02f5868e981302631658dd5d))

## [0.2.0](https://github.com/nimble-123/skills-hub/compare/v0.1.0...v0.2.0) (2026-09-28)


### Features

* cost, usage, MCP servers, collections and plugin bundles ([dc0d7fe](https://github.com/nimble-123/skills-hub/commit/dc0d7fe7333b0cdf50e8173a0ec0e36ce1a65d2c))
* discover, install, update and restore ([212f81a](https://github.com/nimble-123/skills-hub/commit/212f81a7a0ec540f65711c9cae135e4fbc8a32f4))
* **discover:** search the skills.sh registry to find repositories ([7d7155a](https://github.com/nimble-123/skills-hub/commit/7d7155ab97b44777a57243aad6427ac011355234))
* rescan pipeline and the command surface ([ff8b853](https://github.com/nimble-123/skills-hub/commit/ff8b853dea93987c2ddb65a8c91deebaf8385fbc))
* scaffold skills-hub and implement the scanner ([94aaf16](https://github.com/nimble-123/skills-hub/commit/94aaf1653b33317032bbb67c29c6fe6417064796))
* settings as an overlay, and enable/disable that cannot lose files ([c7f3aa5](https://github.com/nimble-123/skills-hub/commit/c7f3aa5c894914e0f03967756ce723ce226798f3))
* **store:** metadata notes that cannot lose the user's work ([461bc21](https://github.com/nimble-123/skills-hub/commit/461bc2186bcbf676303c35d5b8d82c082be0f651))
* **tools:** make the tools page editable ([6d4b852](https://github.com/nimble-123/skills-hub/commit/6d4b852af38f80d597dbcb315fa0031e0b74bbf3))
* **ui:** detail rail, keyboard, project workspaces ([016523b](https://github.com/nimble-123/skills-hub/commit/016523be4d28ac1ecd7575ebea819dc4d87caadd))
* **ui:** edit an item's file, and finish phase one ([ebc9e99](https://github.com/nimble-123/skills-hub/commit/ebc9e994e5ff195a1c4c709f03f7892cab9da6f0))
* **ui:** the library window ([6673481](https://github.com/nimble-123/skills-hub/commit/667348173d17d557007b5cfe215524b12352e171))
* **ui:** the missing pages, a wider rail, and highlighted code ([e9968a7](https://github.com/nimble-123/skills-hub/commit/e9968a7c7b70ee4133320eced613b0c48d9a8fd9))


### Fixes

* **ci:** read the release branch from release-please's own output ([e4064a4](https://github.com/nimble-123/skills-hub/commit/e4064a4ebec928c1107d53d4560cff0c4a8214d3))


### Performance

* **ci:** build verification bundles with a cheaper profile ([33edb34](https://github.com/nimble-123/skills-hub/commit/33edb34a4bae2195eaf4d85d61bb143676c083ce))


### Documentation

* correct what happens to checks on the release PR ([09ce146](https://github.com/nimble-123/skills-hub/commit/09ce146788d2a3d9a0c8af0fec3b69d427b4ff83))
* drop the note about this checkout's filesystem from the README ([067a34d](https://github.com/nimble-123/skills-hub/commit/067a34d9aef4a40fe5f7c58639c17a76ee5c8fc6))
* keep the open points in plan.md ([6779721](https://github.com/nimble-123/skills-hub/commit/677972188169a6e076bdf7d533213042b50f5219))
* let the product page follow an explicit theme choice ([c972110](https://github.com/nimble-123/skills-hub/commit/c9721108c79b2126467304946f18824083f37d50))
* record what the CI profile change actually bought ([8bab09b](https://github.com/nimble-123/skills-hub/commit/8bab09bfa2a7541fff2a9e75008f0c2320fd8d07))
* screenshots, a rewritten README, and a product page ([fe6a031](https://github.com/nimble-123/skills-hub/commit/fe6a03118e8a09d51b2054048e2b4bc591925ae3))
* stage branch protection, and say why step two has to wait ([940a44d](https://github.com/nimble-123/skills-hub/commit/940a44dd357e10f733d7d9d26430fed91607c3e9))


### Build

* settle tauri.conf.json into release-please's formatting ([e584fda](https://github.com/nimble-123/skills-hub/commit/e584fda0236900ed02f5868e981302631658dd5d))
