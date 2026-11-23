# Changelog

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
