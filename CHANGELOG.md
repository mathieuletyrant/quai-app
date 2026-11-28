# Changelog

## [3.2.0](https://github.com/mathieuletyrant/quai-app/compare/v3.1.0...v3.2.0) (2026-11-28)


### ✨ Features

* Live Activities reach their end when the token comes late; Quiet and the ready notification ([#187](https://github.com/mathieuletyrant/quai-app/issues/187)) ([fa7e5fe](https://github.com/mathieuletyrant/quai-app/commit/fa7e5fe9c5ab52281e37a94985a4ac4d7292e258))


### 🐛 Fixes

* a season Reclaimerr unmonitored with its files deleted is gone ([#188](https://github.com/mathieuletyrant/quai-app/issues/188)) ([97251a5](https://github.com/mathieuletyrant/quai-app/commit/97251a56262668ba257626f82ebd8a2475ca85a6))

## [3.1.0](https://github.com/mathieuletyrant/quai-app/compare/v3.0.0...v3.1.0) (2026-11-27)


### ✨ Features

* **ios:** posters are kept on the phone, and one that failed loads again ([#184](https://github.com/mathieuletyrant/quai-app/issues/184)) ([50e05e4](https://github.com/mathieuletyrant/quai-app/commit/50e05e4ab0867b25062342abf9d53e7c0e15e856))

## [3.0.0](https://github.com/mathieuletyrant/quai-app/compare/v2.5.0...v3.0.0) (2026-11-27)


### ⚠ BREAKING CHANGES

* Quai Cloud refuses a Quai Home older than 2.4 (protocol 13): update Quai Home.

### ✨ Features

* drop the allowlist and the Cloud's old path; the Cloud only relays and pushes ([#182](https://github.com/mathieuletyrant/quai-app/issues/182)) ([1f5bc16](https://github.com/mathieuletyrant/quai-app/commit/1f5bc1637099b2e3de3e158c4cf8d335508db219))
* **ios:** the Upcoming tile shows the three soonest rows, and Decline and Remove ask next to their button ([#180](https://github.com/mathieuletyrant/quai-app/issues/180)) ([36e7e66](https://github.com/mathieuletyrant/quai-app/commit/36e7e667ddb494dd19f6b38f6b69215baa3bd98c))

## [2.5.0](https://github.com/mathieuletyrant/quai-app/compare/v2.4.0...v2.5.0) (2026-11-27)


### ✨ Features

* **console:** no Settings page for the hosted Cloud, and the Cloud's version in the sidebar ([#179](https://github.com/mathieuletyrant/quai-app/issues/179)) ([b377d80](https://github.com/mathieuletyrant/quai-app/commit/b377d80fa8abe5b13a818708b03ba182f7bd011b))
* **home:** Quai Home describes everything it answers, as OpenAPI ([#175](https://github.com/mathieuletyrant/quai-app/issues/175)) ([ce0bed6](https://github.com/mathieuletyrant/quai-app/commit/ce0bed680a2d37c225266b9e2cb93ee511e09188))


### 🐛 Fixes

* **console:** the console says what Quai Cloud does now, and whether it is really linked ([#178](https://github.com/mathieuletyrant/quai-app/issues/178)) ([c6fe37a](https://github.com/mathieuletyrant/quai-app/commit/c6fe37a7158dfb58f5ae248cab866a5f3103ad11))


### ⚡ Performance

* a screen's reads are kept a minute, and Quai Home's calls leave together ([#177](https://github.com/mathieuletyrant/quai-app/issues/177)) ([85d4da7](https://github.com/mathieuletyrant/quai-app/commit/85d4da7019afc2fba045823b79efc7e41b4b76de))

## [2.4.0](https://github.com/mathieuletyrant/quai-app/compare/v2.3.1...v2.4.0) (2026-11-27)


### ✨ Features

* an iPhone signs its requests with a device key made at pairing ([#174](https://github.com/mathieuletyrant/quai-app/issues/174)) ([0665725](https://github.com/mathieuletyrant/quai-app/commit/0665725f84d8d484bca3205f3db1fe8035c4943b))
* Quai Home runs Quai; Quai Cloud relays the app and sends the pushes ([#173](https://github.com/mathieuletyrant/quai-app/issues/173)) ([5324f40](https://github.com/mathieuletyrant/quai-app/commit/5324f401be2b04013ed1d1cd4f91b4eaa1bd0d75))


### ⚡ Performance

* **cloud:** reads of the same GET share one call to Quai Home ([#170](https://github.com/mathieuletyrant/quai-app/issues/170)) ([08aaff3](https://github.com/mathieuletyrant/quai-app/commit/08aaff36cb0f7f359915dd52aea846fa2f19f02a))

## [2.3.1](https://github.com/mathieuletyrant/quai-app/compare/v2.3.0...v2.3.1) (2026-11-26)


### 🐛 Fixes

* **ios:** request more seasons from the library, tabs read again, no "Can't reach" card per screen ([#167](https://github.com/mathieuletyrant/quai-app/issues/167)) ([b77b0e5](https://github.com/mathieuletyrant/quai-app/commit/b77b0e542d707982b17cf25668b884dd319e37e9))

## [2.3.0](https://github.com/mathieuletyrant/quai-app/compare/v2.2.0...v2.3.0) (2026-11-26)


### ✨ Features

* a demo home for App Review on demo.quai.stream ([#161](https://github.com/mathieuletyrant/quai-app/issues/161)) ([d573c93](https://github.com/mathieuletyrant/quai-app/commit/d573c93d682a3b97a39ad26b2aa4e78dc825ac31))
* the demo home shows open movies and made-up series, no other image ([#163](https://github.com/mathieuletyrant/quai-app/issues/163)) ([fc2ee9a](https://github.com/mathieuletyrant/quai-app/commit/fc2ee9a5ff669173f8aa81d241a46c987d4be9f7))


### 🐛 Fixes

* **ios:** request more seasons of a series already asked for ([#164](https://github.com/mathieuletyrant/quai-app/issues/164)) ([2fb840d](https://github.com/mathieuletyrant/quai-app/commit/2fb840da515cd3f00d93cb0bb09865bd7c541a51))
* space back no longer blocked by a torrent of another title that weighs the same ([#165](https://github.com/mathieuletyrant/quai-app/issues/165)) ([f9a924c](https://github.com/mathieuletyrant/quai-app/commit/f9a924cc445d3fb6ae6b8756be0de8e27bccc428))

## [2.2.0](https://github.com/mathieuletyrant/quai-app/compare/v2.1.0...v2.2.0) (2026-11-26)


### ✨ Features

* each iPhone orders and hides its Home tiles ([#157](https://github.com/mathieuletyrant/quai-app/issues/157)) ([06ddc05](https://github.com/mathieuletyrant/quai-app/commit/06ddc0576841d24b65003d1d4c8699e3c6d36470))


### 🐛 Fixes

* **ios:** show what comes and what goes next on the Upcoming tile ([#158](https://github.com/mathieuletyrant/quai-app/issues/158)) ([bbb664b](https://github.com/mathieuletyrant/quai-app/commit/bbb664be4abb5c616c272a96b5b3a3711542f1eb))

## [2.1.0](https://github.com/mathieuletyrant/quai-app/compare/v2.0.0...v2.1.0) (2026-11-26)


### ✨ Features

* Storage, each media disk's free space over time and what changed it ([#154](https://github.com/mathieuletyrant/quai-app/issues/154)) ([004e66f](https://github.com/mathieuletyrant/quai-app/commit/004e66f8841f95f2bc88fb73c2cce16fa3361ff7))


### 🐛 Fixes

* a planned deletion shows when Reclaimerr really deletes it ([#152](https://github.com/mathieuletyrant/quai-app/issues/152)) ([1cc60c6](https://github.com/mathieuletyrant/quai-app/commit/1cc60c6626afaed62c27c06830b107da3a28b6d7))

## [2.0.0](https://github.com/mathieuletyrant/quai-app/compare/v0.30.0...v2.0.0) (2026-11-26)


### ✨ Features

* the service under each row, in its logo's colour; only the settings that can fire ([#142](https://github.com/mathieuletyrant/quai-app/issues/142)) ([d26d660](https://github.com/mathieuletyrant/quai-app/commit/d26d66081b775c1db1b431f61ae541c429b4c912))

## [0.30.0](https://github.com/mathieuletyrant/quai-app/compare/v0.29.1...v0.30.0) (2026-11-25)


### ✨ Features

* Gone, a notification once the stack removed something on its own ([#140](https://github.com/mathieuletyrant/quai-app/issues/140)) ([4b7c431](https://github.com/mathieuletyrant/quai-app/commit/4b7c4318a4218542eb84e5c2cb5efb84a5020fc3))

## [0.29.1](https://github.com/mathieuletyrant/quai-app/compare/v0.29.0...v0.29.1) (2026-11-25)


### 🐛 Fixes

* **home:** the link to Quai Cloud stays up after a console answer ([#137](https://github.com/mathieuletyrant/quai-app/issues/137)) ([10cda0b](https://github.com/mathieuletyrant/quai-app/commit/10cda0b48d8fba6bf64d2468621327385f3bcf96))

## [0.29.0](https://github.com/mathieuletyrant/quai-app/compare/v0.28.3...v0.29.0) (2026-11-25)


### ⚠ BREAKING CHANGES

* the code and the contract speak the glossary's words ([#125](https://github.com/mathieuletyrant/quai-app/issues/125))

### 🐛 Fixes

* **ci:** the release PR gets its checks even when release-please leaves it alone ([#134](https://github.com/mathieuletyrant/quai-app/issues/134)) ([77f352e](https://github.com/mathieuletyrant/quai-app/commit/77f352e5c8dbf9913d404cdb70c38c745e5597b1))
* **deploy:** the hosted Cloud's Node heap stays under the lite instance's 256 MiB ([#130](https://github.com/mathieuletyrant/quai-app/issues/130)) ([8f25465](https://github.com/mathieuletyrant/quai-app/commit/8f254650f29a0bca5a035a4bc81bc6b08a29a356))


### ⚡ Performance

* **cloud:** Upcoming and To fix stay linear in the home's size ([#129](https://github.com/mathieuletyrant/quai-app/issues/129)) ([39e4665](https://github.com/mathieuletyrant/quai-app/commit/39e466505d96c284c94eb547fec756b0446e94c5))


### ♻️ Refactoring

* the code and the contract speak the glossary's words ([#125](https://github.com/mathieuletyrant/quai-app/issues/125)) ([1389e6c](https://github.com/mathieuletyrant/quai-app/commit/1389e6c29f5d9d9ff88d621a3c737eb536f3fcb2))

## [0.28.3](https://github.com/mathieuletyrant/quai-app/compare/v0.28.2...v0.28.3) (2026-11-25)


### 🐛 Fixes

* **ios:** a cancelled read no longer shows as a failure ([#123](https://github.com/mathieuletyrant/quai-app/issues/123)) ([81b708c](https://github.com/mathieuletyrant/quai-app/commit/81b708c24786af4984576922bcb46b75783d5c12))
* **ios:** raw strings that hold a hex colour need ## ([#122](https://github.com/mathieuletyrant/quai-app/issues/122)) ([62a52b2](https://github.com/mathieuletyrant/quai-app/commit/62a52b24891ac9502206638a7174edb72ffb3748))

## [0.28.2](https://github.com/mathieuletyrant/quai-app/compare/v0.28.1...v0.28.2) (2026-11-25)


### 🐛 Fixes

* **ios:** freed space on the date line, no request flash in the live bar, a red dot when offline ([#120](https://github.com/mathieuletyrant/quai-app/issues/120)) ([93f4527](https://github.com/mathieuletyrant/quai-app/commit/93f45276008515a467883f2fa6fbb38e4d881bf4))

## [0.28.1](https://github.com/mathieuletyrant/quai-app/compare/v0.28.0...v0.28.1) (2026-11-25)


### 🐛 Fixes

* Upcoming always shows the episode, opens a release's title, frees space past unrelated torrents ([#117](https://github.com/mathieuletyrant/quai-app/issues/117)) ([9b18a15](https://github.com/mathieuletyrant/quai-app/commit/9b18a15f4b64003f1692fab88fee6ac004d1e2ba))

## [0.28.0](https://github.com/mathieuletyrant/quai-app/compare/v0.27.6...v0.28.0) (2026-11-25)


### ✨ Features

* Upcoming, what the stack will do on its own ([#114](https://github.com/mathieuletyrant/quai-app/issues/114)) ([f259e78](https://github.com/mathieuletyrant/quai-app/commit/f259e787bdbe427ffe2f6351460f2e30f5ff5e5d))


### 🐛 Fixes

* **flows:** a download that trickles at 0 % turns grey ([#112](https://github.com/mathieuletyrant/quai-app/issues/112)) ([04cf0dd](https://github.com/mathieuletyrant/quai-app/commit/04cf0ddbf5be5638dd38919b1157ff228435fe45))
* **ios:** remove the "Search in Quai" Siri shortcut ([#116](https://github.com/mathieuletyrant/quai-app/issues/116)) ([5f78822](https://github.com/mathieuletyrant/quai-app/commit/5f78822b342bbab12b10237e015cc32a25467d75))

## [0.27.6](https://github.com/mathieuletyrant/quai-app/compare/v0.27.5...v0.27.6) (2026-11-25)


### 🐛 Fixes

* **flows:** end a download's activity when its release leaves the client ([#109](https://github.com/mathieuletyrant/quai-app/issues/109)) ([40cb9ef](https://github.com/mathieuletyrant/quai-app/commit/40cb9efd10cd760ef90afa0a5908d350254a3977))
* **link:** a few seconds without the Cloud lose nothing and log nothing ([#110](https://github.com/mathieuletyrant/quai-app/issues/110)) ([61cc18c](https://github.com/mathieuletyrant/quai-app/commit/61cc18c826257bce0976ec308467d99412ef5cc6))

## [0.27.5](https://github.com/mathieuletyrant/quai-app/compare/v0.27.4...v0.27.5) (2026-11-24)


### 🐛 Fixes

* **deploy:** the hosted Cloud reports the version it runs ([#107](https://github.com/mathieuletyrant/quai-app/issues/107)) ([f4c9fc7](https://github.com/mathieuletyrant/quai-app/commit/f4c9fc7c46653676961fab9752e955b5addd5da9))

## [0.27.4](https://github.com/mathieuletyrant/quai-app/compare/v0.27.3...v0.27.4) (2026-11-24)


### 🐛 Fixes

* list Jellyfin's library as an administrator to find new titles ([#103](https://github.com/mathieuletyrant/quai-app/issues/103)) ([8a37812](https://github.com/mathieuletyrant/quai-app/commit/8a3781246d0e5b813b9d826000564dff13f87067))

## [0.27.3](https://github.com/mathieuletyrant/quai-app/compare/v0.27.2...v0.27.3) (2026-11-24)


### 🐛 Fixes

* **cloud:** find a title in Jellyfin by any id both know, TMDB, TVDB or IMDb ([#101](https://github.com/mathieuletyrant/quai-app/issues/101)) ([c47a808](https://github.com/mathieuletyrant/quai-app/commit/c47a8081913efd4325d3dd8619973f5007ab5289))

## [0.27.2](https://github.com/mathieuletyrant/quai-app/compare/v0.27.1...v0.27.2) (2026-11-24)


### 🐛 Fixes

* follow titles to Jellyfin by id, keep a season pack's name, show blocked imports ([#99](https://github.com/mathieuletyrant/quai-app/issues/99)) ([7052b14](https://github.com/mathieuletyrant/quai-app/commit/7052b14e624825c4a20c16f50ea1dba94c9675ef))

## [0.27.1](https://github.com/mathieuletyrant/quai-app/compare/v0.27.0...v0.27.1) (2026-11-24)


### 🐛 Fixes

* **ios:** library posters, search loader and tapping a search result ([#97](https://github.com/mathieuletyrant/quai-app/issues/97)) ([3eec83f](https://github.com/mathieuletyrant/quai-app/commit/3eec83f0f3134857e8232c92753b1192d93ce615))

## [0.27.0](https://github.com/mathieuletyrant/quai-app/compare/v0.26.0...v0.27.0) (2026-11-24)


### ✨ Features

* search Seerr and request a title from the app, the Lock Screen and Siri ([#95](https://github.com/mathieuletyrant/quai-app/issues/95)) ([96f44b5](https://github.com/mathieuletyrant/quai-app/commit/96f44b50f67675670463c37a991a7472986fad4b))


### 🐛 Fixes

* **ios:** no "Can't reach" tile when coming back to the app, and a connection mark on the Home ([#94](https://github.com/mathieuletyrant/quai-app/issues/94)) ([0e1a99b](https://github.com/mathieuletyrant/quai-app/commit/0e1a99b2564cf07f203eabe7f8b5a0f850b9ac5e))

## [0.26.0](https://github.com/mathieuletyrant/quai-app/compare/v0.25.1...v0.26.0) (2026-11-24)


### ✨ Features

* a fuller Home, releases that open their title, the app on the landing, disabled flows end their activities ([#91](https://github.com/mathieuletyrant/quai-app/issues/91)) ([f29bbfd](https://github.com/mathieuletyrant/quai-app/commit/f29bbfd6d76a4c83c07f33f219ff1d27db175642))

## [0.25.1](https://github.com/mathieuletyrant/quai-app/compare/v0.25.0...v0.25.1) (2026-11-24)


### 🐛 Fixes

* iPhone-only iOS build, and the Discord's permanent invite ([#88](https://github.com/mathieuletyrant/quai-app/issues/88)) ([97bd6ad](https://github.com/mathieuletyrant/quai-app/commit/97bd6ad480c59d6d6d5a83807eff11608b10dfef))

## [0.25.0](https://github.com/mathieuletyrant/quai-app/compare/v0.24.0...v0.25.0) (2026-11-24)


### ⚠ BREAKING CHANGES

* QUAI_CONSOLE_PUBLIC_URL for "Open the console", and Cloud-only names for the Cloud's public address ([#86](https://github.com/mathieuletyrant/quai-app/issues/86))

### ✨ Features

* QUAI_CONSOLE_PUBLIC_URL for "Open the console", and Cloud-only names for the Cloud's public address ([#86](https://github.com/mathieuletyrant/quai-app/issues/86)) ([ab3b118](https://github.com/mathieuletyrant/quai-app/commit/ab3b11884cd30a0dcdf3c59f1ab1bc088fd1c726))

## [0.24.0](https://github.com/mathieuletyrant/quai-app/compare/v0.23.0...v0.24.0) (2026-11-24)


### ✨ Features

* clearer Settings for the hosted Cloud, the console's own address in the app, landing rework ([#84](https://github.com/mathieuletyrant/quai-app/issues/84)) ([d909c2b](https://github.com/mathieuletyrant/quai-app/commit/d909c2b6709640dd0b38504e9e2f83d35b8e8231))

## [0.23.0](https://github.com/mathieuletyrant/quai-app/compare/v0.22.0...v0.23.0) (2026-11-24)


### ✨ Features

* **cloud:** host Quai Cloud on Cloudflare Containers at cloud.quai.stream ([#83](https://github.com/mathieuletyrant/quai-app/issues/83)) ([d52e7e3](https://github.com/mathieuletyrant/quai-app/commit/d52e7e3d8d6c44102274a592113df28b5dfc332f))
* **site:** add the website and deploy it to quai.stream ([#79](https://github.com/mathieuletyrant/quai-app/issues/79)) ([043a5f4](https://github.com/mathieuletyrant/quai-app/commit/043a5f4fb4f67cecc51931ce634bd4e1015e5a3b))


### 🐛 Fixes

* **site:** run the deploy script, not pnpm's own deploy command ([#81](https://github.com/mathieuletyrant/quai-app/issues/81)) ([f8422c2](https://github.com/mathieuletyrant/quai-app/commit/f8422c290099d840296f507418e0e3eb0849c6d1))
* **site:** run the deploy script, not pnpm's own deploy command ([#82](https://github.com/mathieuletyrant/quai-app/issues/82)) ([37bd002](https://github.com/mathieuletyrant/quai-app/commit/37bd002e1ee5070dbd387929b29cccceab240733))

## [0.22.0](https://github.com/mathieuletyrant/quai-app/compare/v0.21.0...v0.22.0) (2026-11-24)


### ✨ Features

* **cloud:** serve many homes from one Quai Cloud ([#77](https://github.com/mathieuletyrant/quai-app/issues/77)) ([902c82e](https://github.com/mathieuletyrant/quai-app/commit/902c82e62e72be730a691b660cf8562e8d5392bf))

## [0.21.0](https://github.com/mathieuletyrant/quai-app/compare/v0.20.0...v0.21.0) (2026-11-23)


### ✨ Features

* **ios:** show posters on the Home's Out today tile ([#72](https://github.com/mathieuletyrant/quai-app/issues/72)) ([3090a12](https://github.com/mathieuletyrant/quai-app/commit/3090a128ad7d08f5c9e96a8aaf88857ad30a7a46))

## [0.20.0](https://github.com/mathieuletyrant/quai-app/compare/v0.19.0...v0.20.0) (2026-11-23)


### ⚠ BREAKING CHANGES

* the console is served by quai-home on :8788 behind QUAI_HOME_PASSWORD (locked without it); Quai Cloud serves no console and refuses /console-api on its port. Update Quai Home and Quai Cloud together.

### ✨ Features

* serve the console from Quai Home, with a Services page for the keys ([#71](https://github.com/mathieuletyrant/quai-app/issues/71)) ([3a3c5f0](https://github.com/mathieuletyrant/quai-app/commit/3a3c5f0d1807222d38727f9da135299a83a8fb8b))

## [0.19.0](https://github.com/mathieuletyrant/quai-app/compare/v0.18.2...v0.19.0) (2026-11-23)


### ✨ Features

* **ios:** show the Home's tiles as skeletons while they load ([0d094c3](https://github.com/mathieuletyrant/quai-app/commit/0d094c38f8ae0d4d9b335c47f593085fbfb19cb0))

## [0.18.2](https://github.com/mathieuletyrant/quai-app/compare/v0.18.1...v0.18.2) (2026-11-23)


### 🐛 Fixes

* send a Live Activity's Start again when Apple doesn't answer, and don't reuse an idle connection ([#67](https://github.com/mathieuletyrant/quai-app/issues/67)) ([9165bdb](https://github.com/mathieuletyrant/quai-app/commit/9165bdb84caff08cde733ae5a236e2efd55b41b7))

## [0.18.1](https://github.com/mathieuletyrant/quai-app/compare/v0.18.0...v0.18.1) (2026-11-23)


### 🐛 Fixes

* read Reclaimerr's candidates every minute, so a planned deletion is notified at once ([#65](https://github.com/mathieuletyrant/quai-app/issues/65)) ([aa16653](https://github.com/mathieuletyrant/quai-app/commit/aa166537b950d56920b26017a25dceda1a0c9a49))

## [0.18.0](https://github.com/mathieuletyrant/quai-app/compare/v0.17.0...v0.18.0) (2026-11-21)


### ✨ Features

* notify a deletion Reclaimerr plans, and say why in plain words ([#63](https://github.com/mathieuletyrant/quai-app/issues/63)) ([dba83fe](https://github.com/mathieuletyrant/quai-app/commit/dba83fe54123b39f4cf734a4aa0752d3f33cd291))

## [0.17.0](https://github.com/mathieuletyrant/quai-app/compare/v0.16.1...v0.17.0) (2026-11-21)


### ✨ Features

* **ios:** a feedback loop without a Mac: contract checks, a preview server, screenshots on the PR ([#58](https://github.com/mathieuletyrant/quai-app/issues/58)) ([dad32f3](https://github.com/mathieuletyrant/quai-app/commit/dad32f3e7a2156f6ce609937ba54d08445e86798))
* open titles in Radarr or Sonarr, and follow their own Missing and Not Available ([#62](https://github.com/mathieuletyrant/quai-app/issues/62)) ([5132855](https://github.com/mathieuletyrant/quai-app/commit/5132855c4e1f0525b72d11a377053088ebffbf37))

## [0.16.1](https://github.com/mathieuletyrant/quai-app/compare/v0.16.0...v0.16.1) (2026-11-20)


### 🐛 Fixes

* **ios:** Play/Pause shows at once in the app, and playback moves on its own ([#56](https://github.com/mathieuletyrant/quai-app/issues/56)) ([c223705](https://github.com/mathieuletyrant/quai-app/commit/c2237050156af274b8ddacdbf0153eea7ae93c95))

## [0.16.0](https://github.com/mathieuletyrant/quai-app/compare/v0.15.0...v0.16.0) (2026-11-20)


### ✨ Features

* **ios:** a live bar over the tabs, and a Home about what needs you ([#54](https://github.com/mathieuletyrant/quai-app/issues/54)) ([f185448](https://github.com/mathieuletyrant/quai-app/commit/f185448a5784a9517b55ee680b2fe85365679bb0))

## [0.15.0](https://github.com/mathieuletyrant/quai-app/compare/v0.14.0...v0.15.0) (2026-11-20)


### ✨ Features

* a fuller Home, the journal in the app, and alerts ([#51](https://github.com/mathieuletyrant/quai-app/issues/51)) ([6aebeb0](https://github.com/mathieuletyrant/quai-app/commit/6aebeb07275292faf6ce92c533dfe6ce5a943fa6))

## [0.14.0](https://github.com/mathieuletyrant/quai-app/compare/v0.13.0...v0.14.0) (2026-11-20)


### ✨ Features

* Cleanuparr's planned removals in To fix, its removals in the Journal ([#49](https://github.com/mathieuletyrant/quai-app/issues/49)) ([e140da5](https://github.com/mathieuletyrant/quai-app/commit/e140da5aaa09a8901b4ad71253ca9ca4f91bf983))

## [0.13.0](https://github.com/mathieuletyrant/quai-app/compare/v0.12.3...v0.13.0) (2026-11-20)


### ✨ Features

* Journal in the console, kept by Quai Home; phone menu ([#46](https://github.com/mathieuletyrant/quai-app/issues/46)) ([926e46b](https://github.com/mathieuletyrant/quai-app/commit/926e46b4250f5158e1cbe335c2af42d7782b6a8a))
* show the day's releases as "Today" ([#45](https://github.com/mathieuletyrant/quai-app/issues/45)) ([e5e4112](https://github.com/mathieuletyrant/quai-app/commit/e5e41121765700fcfa9f22353cb3e853f5fc19cd))
* the app to live with Quai, the console to set it up ([#48](https://github.com/mathieuletyrant/quai-app/issues/48)) ([6fdd558](https://github.com/mathieuletyrant/quai-app/commit/6fdd558e772bd9a6588302a83c0f8d6d87977a3e))

## [0.12.3](https://github.com/mathieuletyrant/quai-app/compare/v0.12.2...v0.12.3) (2026-11-20)


### 🐛 Fixes

* Lock Screen Approve/Decline refuse a request no longer pending; one To fix adapter per media kind, one Seerr decide, reads defined once, iOS errors mapped once ([#41](https://github.com/mathieuletyrant/quai-app/issues/41)) ([999fe09](https://github.com/mathieuletyrant/quai-app/commit/999fe0952cb8edd245d7b9eb7abd6df2e6ec89e6))

## [0.12.2](https://github.com/mathieuletyrant/quai-app/compare/v0.12.1...v0.12.2) (2026-11-20)


### 🐛 Fixes

* audit findings (engine crash, APNs timeout, unreadable document, home pinning, qBittorrent login) ([#39](https://github.com/mathieuletyrant/quai-app/issues/39)) ([61067b0](https://github.com/mathieuletyrant/quai-app/commit/61067b09467951a53dc46d197f8a311a22807ead))

## [0.12.1](https://github.com/mathieuletyrant/quai-app/compare/v0.12.0...v0.12.1) (2026-11-20)


### 🐛 Fixes

* **cloud:** Library and Tonight answer 503 when Quai Home drops mid-read ([#37](https://github.com/mathieuletyrant/quai-app/issues/37)) ([8d12886](https://github.com/mathieuletyrant/quai-app/commit/8d12886da86d9bf52eece222316faf757413f65a))

## [0.12.0](https://github.com/mathieuletyrant/quai-app/compare/v0.11.0...v0.12.0) (2026-11-20)


### ✨ Features

* Seerr requests to approve, tonight's releases ([#34](https://github.com/mathieuletyrant/quai-app/issues/34)) ([24e6150](https://github.com/mathieuletyrant/quai-app/commit/24e61503585e01310cc5f0d57a17fa6501d4e0e9))

## [0.11.0](https://github.com/mathieuletyrant/quai-app/compare/v0.10.0...v0.11.0) (2026-11-20)


### ✨ Features

* refresh download progress every 5 s ([#32](https://github.com/mathieuletyrant/quai-app/issues/32)) ([012574b](https://github.com/mathieuletyrant/quai-app/commit/012574b7f923edc3c7e324f37fee31ca4f8fe49e))

## [0.10.0](https://github.com/mathieuletyrant/quai-app/compare/v0.9.0...v0.10.0) (2026-11-19)


### ✨ Features

* posters on To fix, settings tab, unmonitored titles ([#31](https://github.com/mathieuletyrant/quai-app/issues/31)) ([e45edb6](https://github.com/mathieuletyrant/quai-app/commit/e45edb6c270b27adfce6cfdae599dfdd7031d69a))


### 🐛 Fixes

* **console:** open the pairing link in Quai when the console is on the iPhone ([#29](https://github.com/mathieuletyrant/quai-app/issues/29)) ([4ca0354](https://github.com/mathieuletyrant/quai-app/commit/4ca03548d4e5c5c6f52f36db9dc6cea6015b9a83))

## [0.9.0](https://github.com/mathieuletyrant/quai-app/compare/v0.8.0...v0.9.0) (2026-11-19)


### ✨ Features

* access headers for a reverse proxy in front of Quai Cloud ([#27](https://github.com/mathieuletyrant/quai-app/issues/27)) ([fa954ca](https://github.com/mathieuletyrant/quai-app/commit/fa954ca3180127f6edbded827dd4990ed3674096))

## [0.8.0](https://github.com/mathieuletyrant/quai-app/compare/v0.7.0...v0.8.0) (2026-11-19)


### ✨ Features

* To fix — blocked imports, no source, scheduled deletions ([#24](https://github.com/mathieuletyrant/quai-app/issues/24)) ([f37699a](https://github.com/mathieuletyrant/quai-app/commit/f37699a517c5da6622115ae8957075ee8cd63ac5))

## [0.7.0](https://github.com/mathieuletyrant/quai-app/compare/v0.6.0...v0.7.0) (2026-11-19)


### ✨ Features

* black redesign of the console and the app, Home and Library tabs ([#23](https://github.com/mathieuletyrant/quai-app/issues/23)) ([e2c5a80](https://github.com/mathieuletyrant/quai-app/commit/e2c5a8003143ef599e74980db8f1a91d4afb087f))


### 🐛 Fixes

* **testflight:** sign the archive again, revoke CI development certificates ([#21](https://github.com/mathieuletyrant/quai-app/issues/21)) ([0577f2f](https://github.com/mathieuletyrant/quai-app/commit/0577f2f6f937476cf9e49b97f5dca0c2293a96b4))

## [0.6.0](https://github.com/mathieuletyrant/quai-app/compare/v0.5.1...v0.6.0) (2026-11-19)


### ✨ Features

* Quai Home and Quai Cloud (spec v2) ([#18](https://github.com/mathieuletyrant/quai-app/issues/18)) ([1eda107](https://github.com/mathieuletyrant/quai-app/commit/1eda1079c71334f7cac86834148c1436166e3732))

## [0.5.1](https://github.com/mathieuletyrant/quai-app/compare/v0.5.0...v0.5.1) (2026-11-18)


### 🐛 Fixes

* **server:** a playback shows its countdown, not a stale 0 % ([#16](https://github.com/mathieuletyrant/quai-app/issues/16)) ([18ad42a](https://github.com/mathieuletyrant/quai-app/commit/18ad42ae6bab15e474fae2a27d6ab6d10a036cfb))

## [0.5.0](https://github.com/mathieuletyrant/quai-app/compare/v0.4.0...v0.5.0) (2026-11-18)


### ✨ Features

* console redesign, tests on chosen iPhones, playback pause and dismissed activities fixed ([#14](https://github.com/mathieuletyrant/quai-app/issues/14)) ([8110a22](https://github.com/mathieuletyrant/quai-app/commit/8110a22df7d726201f45eacae5f68dfcf55512aa))

## [0.4.0](https://github.com/mathieuletyrant/quai-app/compare/v0.3.4...v0.4.0) (2026-11-18)


### ✨ Features

* choose the Live Activity's steps on each iPhone, with a test button, and a redesign ([#11](https://github.com/mathieuletyrant/quai-app/issues/11)) ([66e207e](https://github.com/mathieuletyrant/quai-app/commit/66e207e587b07e317c22c4dc4d0fcd6696b3815a))
* flows — build your own Live Activities ([#13](https://github.com/mathieuletyrant/quai-app/issues/13)) ([93114c6](https://github.com/mathieuletyrant/quai-app/commit/93114c6c92a677e0ea55bf4c9153e6f02ae1cc2b))

## [0.3.4](https://github.com/mathieuletyrant/quai-app/compare/v0.3.3...v0.3.4) (2026-11-18)


### 🐛 Fixes

* **server:** push download progress at high priority, and log each push ([f7ad54c](https://github.com/mathieuletyrant/quai-app/commit/f7ad54c2a4566e54a39e83b572bd92ad2ec2bfdc))

## [0.3.3](https://github.com/mathieuletyrant/quai-app/compare/v0.3.2...v0.3.3) (2026-11-18)


### 🐛 Fixes

* **server:** keep running activities across restarts ([09b02c7](https://github.com/mathieuletyrant/quai-app/commit/09b02c78b9a14bf7a02b0ad036554696ed8c1c19))

## [0.3.2](https://github.com/mathieuletyrant/quai-app/compare/v0.3.1...v0.3.2) (2026-11-18)


### 🐛 Fixes

* **server:** progressive qBittorrent login backoff ([d071413](https://github.com/mathieuletyrant/quai-app/commit/d071413276275c9d2c34928676130d596f37813a))
* **server:** qBittorrent 5 session cookie, and no login storm ([3586304](https://github.com/mathieuletyrant/quai-app/commit/358630483e6895cd40207254cf936d37bbae9108))

## [0.3.1](https://github.com/mathieuletyrant/quai-app/compare/v0.3.0...v0.3.1) (2026-11-18)


### 🐛 Fixes

* **ios:** app icon, iPhone only, portrait ([ab4a20a](https://github.com/mathieuletyrant/quai-app/commit/ab4a20a7ad5f4909fac3bac24cfb540e587be874))
* **ios:** declare every orientation ([358f704](https://github.com/mathieuletyrant/quai-app/commit/358f70460c692213095d499f520e2a17ce44cbb1))
* **ios:** take the version and build number from the build settings ([b2b4dcd](https://github.com/mathieuletyrant/quai-app/commit/b2b4dcd572a60d9470a42d3904d76708d77b65df))

## [0.3.0](https://github.com/mathieuletyrant/quai-app/compare/v0.2.2...v0.3.0) (2026-11-18)


### ✨ Features

* set the Apple push key from the console ([76b6845](https://github.com/mathieuletyrant/quai-app/commit/76b6845be90a1d1f0fbb37b2582d56fd81ca93da))

## [0.2.2](https://github.com/mathieuletyrant/quai-app/compare/v0.2.1...v0.2.2) (2026-11-18)


### 🐛 Fixes

* bundle id com.mathieuletyrant.quai ([5968583](https://github.com/mathieuletyrant/quai-app/commit/5968583c4a02dcf1656fe83330014cc780df3d84))

## [0.2.1](https://github.com/mathieuletyrant/quai-app/compare/v0.2.0...v0.2.1) (2026-11-18)


### 🐛 Fixes

* **server:** start without the APNs key file ([eae33f1](https://github.com/mathieuletyrant/quai-app/commit/eae33f16c89d2570ab70d330264e119f025d0ec6))

## [0.2.0](https://github.com/mathieuletyrant/quai-app/compare/v0.1.0...v0.2.0) (2026-11-18)


### ✨ Features

* Download Live Activity, end to end (milestone 2) ([d488c85](https://github.com/mathieuletyrant/quai-app/commit/d488c85361432091942ca184149212cb0bf920e1))

## 0.1.0 (2026-11-18)


### ✨ Features

* Quai icon from the design mockups ([c785cf3](https://github.com/mathieuletyrant/quai-app/commit/c785cf3b95beb56e7187af72793ab83acacd4f3f))


### 🐛 Fixes

* **ios:** nest the widget extension's bundle id under the app's ([10f73aa](https://github.com/mathieuletyrant/quai-app/commit/10f73aaffc60758ebbaba7b40939106208305ee2))
