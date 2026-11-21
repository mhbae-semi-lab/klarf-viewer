# Klarf 웨이퍼 맵 뷰어 (klarf-viewer)

KLARF **1.2 · 1.8** 결함 파일을 브라우저에서 열어 웨이퍼 맵을 보고, 열 때마다 **맵 정의**(다이 pitch · 스크라이브 · 원점 다이 · 웨이퍼 밖 결함 · 다이 인덱스)가 실제 결함 배열과 맞는지 먼저 검증하는 웹 앱(PWA)입니다. 서버가 없고, 파일은 브라우저 밖으로 나가지 않습니다.

**바로 열기: https://mhbae-semi-lab.github.io/klarf-viewer/** (설치 없음, 예시 Klarf 가 열려 있음)

[English summary](#english)

## 1. 관점

레시피와 맵을 만들던 사람의 눈으로 본 결함 파일 뷰어입니다. 결함 분포를 보기 전에 **이 맵 정의로 그린 그림을 믿어도 되는지**부터 확인합니다.

- 포트폴리오 사례 **"Feature 등록 없는 Wafer Align"** 에서 다이 배열의 주기에 격자를 맞춰 각도를 구했듯이, 이 앱은 결함 위치에서 **다이 주기와 격자 위상**을 찾아 선언된 DiePitch · 격자 원점과 비교합니다.
- 포트폴리오 사례 **"검사 Recipe 자동 생성"** 에서 도면과 맵으로 Recipe 를 만들 때 맵 정의부터 검증하던 일을 결함 파일 쪽에서 다시 한 것입니다. pitch 오타, 스크라이브 폭 누락, 원점 다이 지정 오류, 인덱스 기준 차이는 결함 지도를 그럴듯하게 틀리게 만듭니다.

## 2. 해결

- 장비 PC 가 아닌 아무 PC 에서나 Klarf 를 열어 웨이퍼 맵(다이 격자 · 클래스별 색 · 확대 / 이동)과 결함 분포를 봅니다. 결함 100만 개도 몇 초 안에 열고 끊김 없이 움직입니다.
- 열 때 **맵 정의 검증 5종**이 자동으로 돌고, 오류마다 걸린 다이 · 결함을 지도에 강조합니다. 원인을 추정한 오류(pitch · 스크라이브 · 원점 · 인덱스)는 **추정값으로 고쳐 본 맵**을 보여주고 다시 검증합니다 (파일은 바꾸지 않음).
- 보기: 결함 · 다이 히트맵 · 웨이퍼 겹치기(여러 장의 같은 자리 결함) · 다이 겹치기(모든 다이를 한 다이에 겹친 밀도, 스크라이브 · 레티클 반복이 보임) · 두 파일 비교(A 에만 · B 에만 · 공통 + 맵 정의 비교).
- 필터(클래스 · 크기 · 검증에 걸린 결함), 결함 표 · 다이 표 · 반복 결함 표, PNG · CSV · 요약(JSON) 내보내기.
- **현장 검증 절차**: 검증 규칙(허용 차이 · 여유)을 바꾸기 전에 맵 오류가 하나씩 들어간 재현 세트로 잡음 · 놓침 · 오검을 비교하고, 새 규칙은 Shadow 로 먼저 돌려 본 뒤 전환하고, 언제든 되돌립니다.

## 3. 상용 비교 · 차별점 (조사 2026-11-22)

| 제품 | 형태 | KLARF | 이 앱과 관련된 기능 |
|---|---|---|---|
| KLA Klarity Defect | 사내 설치형 서버 | 자사 형식 | 겹치기 · 반복 결함 · 공간 패턴(SSA) 분석 |
| yieldWerx | 웹 YMS (서버) | 버전 미기재 | KLARF 자동 수집, 겹치기 |
| PDF Solutions Exensio | 서버 · 클라우드 | 버전 미기재 | 다이 · 레티클 · 웨이퍼 단위 계통 분석 |
| LVTailoring KLARF Viewer | 설치형 데스크톱 | 버전 미기재 | 여러 파일 병합, 딥러닝 분류 |
| semitool | 브라우저 (로컬 파싱), MIT | 1.x 평면형 (1.8 Record 형식 없음, 공개 코드 기준) | KLARF · STDF 보기, 군집 |
| WaferScope | 브라우저 (로컬 파싱), 비공개 베타 | 1.2 (공개 번들 기준) | 겹치기, 플랜 밖(off-die) 필터, edge exclusion 경고 |
| klarfkit · klarf-reader · klarfrs | Python · Rust 라이브러리 | 1.x (klarfrs README 는 1.8 도 표기) | 읽기 · 쓰기, 겹치기(klarfkit) |
| klarfio · jklarfreader | Python · Java 라이브러리 | 1.2 · 1.8 | 읽기 · 쓰기, validate CLI(jklarfreader, 범위 미기재) |

출처: [KLA 데이터 분석](https://kla.com/products/chip-manufacturing/data-analytics) · [Klarity SSA](https://phys.org/news/2004-07-kla-tencor-yield-enables-baseline-automated.html) · [yieldWerx](https://yieldwerx.com/products/product-suite/defect-management-2/) · [PDF Exensio](https://www.pdf.com/wp-content/uploads/2025/12/PDF-Defect-Management-re-4-Spotfire-no-nda.pdf) · [LVTailoring](https://www.lvtailoring.net/klarfviewer) · [semitool](https://github.com/doublej9999/semitool) · [WaferScope](https://waferscope.dev/) · [klarfkit](https://github.com/MichaelHotaling/klarfkit) · [klarf-reader](https://github.com/Impro02/klarf-reader) · [klarfrs](https://github.com/banickn/klarfrs) · [klarfio](https://github.com/hadriman/klarfio) · [jklarfreader](https://github.com/btrapp/jklarfreader)

**이 앱이 다른 점** (조사한 제품 중에서 찾지 못함, 2026-11 기준)

1. 설치 없이 **브라우저에서 KLARF 1.2 와 1.8(레코드형)을 모두 로컬로** 읽습니다. 브라우저에서 로컬로 읽는 KLARF 뷰어 자체는 semitool · WaferScope 가 있지만, 공개 코드 기준으로 둘 다 1.8 Record 형식은 읽지 않습니다.
2. 파일을 열 때 **맵 정의를 결함 배열과 대조해 오류로 보고**합니다: 결함 위치의 다이 주기 ↔ DiePitch, 결함 없는 띠(스크라이브) ↔ 격자 원점, 테스트 플랜 ↔ 웨이퍼 원, 웨이퍼 밖 결함, XREL · XINDEX ↔ 테스트 플랜. 원인으로 설명되는 증상은 따로 세지 않고, 추정값으로 고쳐 본 맵을 다시 검증합니다. 공개 문서에서는 플랜 밖 결함 필터 · edge 경고(WaferScope) 같은 부분 기능만 찾았습니다.

## 4. 설치 · 사용

- 웹 주소(https://mhbae-semi-lab.github.io/klarf-viewer/)에서 바로 열거나, 브라우저의 "앱 설치"로 PWA 를 설치합니다. 한 번 열면 오프라인에서도 열립니다.
- 로컬 실행 (빌드 없음):
  ```
  python -m http.server 8753 --bind 127.0.0.1
  ```
  → `http://127.0.0.1:8753/`
- 사용 순서: 예시 Klarf(합성)가 처음부터 열려 있습니다 → 오른쪽 "맵 정의 검증" → 예시 목록의 맵 오류 5종 · 두 파일 비교 · 100만 개 예시 → 내 Klarf 는 끌어다 놓기(여러 개 가능) → "현장 검증" 4단계.
- 읽는 형식: KLARF 1.1 · 1.2(평면형), 1.8(레코드형, nm → µm). 웨이퍼 여러 장, 시험 여러 개, 줄을 넘는 행, IMAGELIST, `NA` 값. 읽지 못한 줄은 줄 번호와 사유를 보여주고 나머지는 계속 읽습니다. 형식 근거: [docs/klarf-format.md](docs/klarf-format.md).
- 저장: 이 브라우저의 IndexedDB (설정 · 검증 규칙 이력 · Shadow 기록 · 재현 사례 · 마지막으로 연 파일 합계 200MB 미만). 설정에서 JSON 백업 · 가져오기 · 전체 삭제.
- 사용자 매뉴얼: [docs/manual/Klarf-Viewer-User-Manual-ko.pdf](docs/manual/Klarf-Viewer-User-Manual-ko.pdf)

### 개발

```
node --test                                          # 단위 · 회귀 테스트 (의존성 없음, Node 20+)
node --max-old-space-size=6000 tools/bench.mjs 1000000   # 결함 100만 개 1.2 · 1.8 파싱 · 검증 시간 (Node)
python tools/serve.py 8753                           # 개발용 서버 (캐시 끔)
node tools/measure.mjs http://127.0.0.1:8753/        # Chrome 에서 100만 개 열기 시간 · 이동 fps (--headed 로 창 띄움)
node docs/manual/capture.mjs http://127.0.0.1:8753/  # 매뉴얼 화면 캡처 (Chrome 필요)
python docs/manual/build_manual.py                   # 매뉴얼 PPTX 생성 (python-pptx, Pillow)
```

- 정적 파일(바닐라 JS, ES 모듈)만 있고 빌드 단계가 없습니다. 외부 CDN 을 쓰지 않습니다. `vendor/pretendard/` 는 `pretendard@1.3.9` 의 woff2-subset 중 쓰는 굵기 4종입니다.
- 결함 점은 WebGL 로 그립니다 (위치 · 색 버퍼를 한 번 올리고 확대 · 이동은 uniform 만 바꿈). WebGL 이 없으면 픽셀 버퍼로 그립니다 (느림).

## 5. 측정값

| 항목 | 결과 |
|---|---|
| 결함 100만 개 열기 (Chrome, Worker 파싱 + 검증 + 첫 그리기) | 1.2 (68MB): 2.4 ~ 2.8초 · 1.8 (68MB): 2.3 ~ 2.4초 (`tools/measure.mjs`, Intel Iris Xe, headless · 창 모드) |
| 100만 개 지도 이동 · 확대 3초 | 164 ~ 165 fps, 프레임 중앙값 6.1 ms · p95 6.2 ~ 6.3 ms |
| 결함 100만 개 파싱 · 검증 (Node 24) | 1.2: 1.9초 + 0.3초 · 1.8: 1.5초 + 0.2초 (`tools/bench.mjs`, GitHub Actions ubuntu: 1.2초 · 0.8초) |
| 합성 맵 오류 5종 | 5 / 5 검출, 각 파일에서 그 오류 하나만 보고 |
| 원인 추정 (넣은 값 → 추정값) | pitch X 9,840 → 실제 주기 9,599.8 µm (실제 9,600) · 스크라이브 원점 +2,400 → −2,400 µm · 원점 (+1, −1) 다이 · 인덱스 (−1, 0) |
| 정상 합성 웨이퍼 24장 (예시 4장 + 다른 시드 20장) | 맵 오류 오검 0 |
| 고쳐 본 맵 다시 검증 | pitch · 스크라이브 · 원점 · 인덱스 4종 모두 오류 0 (웨이퍼 밖 결함은 진짜 결함이라 남음) |
| 단위 · 회귀 테스트 | `node --test` 22개 통과 |

측정 원본: [docs/measurements/](docs/measurements/)

## 6. 한계

- 검증 규칙과 기본 허용값은 **합성 데이터로만** 맞췄습니다. 실제 장비 파일에서는 허용값을 "현장 검증 → 비교"로 다시 맞춰야 할 수 있습니다.
- pitch · 스크라이브 판정은 결함 배열에 다이마다 되풀이되는 구조(반복 결함, 검사하지 않은 스크라이브의 빈 띠)가 있어야 합니다. 결함이 2,000개 미만이거나 신호가 약하면 판정하지 않고 '참고'로 적습니다. 스크라이브는 빈 띠만 봅니다 (짙은 띠는 반복 결함과 헷갈려 보지 않음).
- 형식은 공개 오픈소스의 코드 · 시험 파일로만 확인했습니다. 장비별 방언(추가 키워드 등)은 건너뛰고 셉니다. `CoordinatesMirrored` · `InspectionOrientation` 은 의미를 공개 자료에서 확인하지 못해 적용하지 않고, +Y 가 위쪽이라고 봅니다. `DieOrigin` 은 공개 구현처럼 계산에 쓰지 않습니다.
- 1.8 의 길이 단위는 `SampleSize` 크기로 nm · µm 를 가립니다. 결함 이미지(TIFF · JPG)는 보여주지 않습니다. 플랫(FLAT) 웨이퍼도 노치 위치 표시만 합니다.
- 메모리: 결함 100만 개에 JS 힙 약 180MB(1.2) · 250MB(1.8). 60fps 는 WebGL 이 켜진 브라우저 기준입니다.

## 7. 만든 방법

배민혁이 설계하고, 구현 · 테스트 · 문서 작성에 AI 코딩 도구(Claude Code)를 썼습니다. 예시 Klarf 는 모두 `src/gen.js` 로 만든 합성 데이터이며 실제 장비 · 제품과 관련이 없습니다.

라이선스: MIT. 포함한 서드파티: Pretendard (SIL OFL 1.1).

---

## English

**Klarf Wafer Map Viewer** opens KLARF **1.2 and 1.8** defect files in the browser and, every time a file opens, checks the **map definition** (die pitch · scribe · origin die · defects outside the wafer · die index) against the actual defect layout before you look at the defects. No server; files never leave the browser.

- Five map-definition checks: die period from defect positions vs DiePitch, defect-free band (scribe) vs grid origin, test plan vs wafer circle, defects outside the wafer, XREL · XINDEX vs test plan. Symptoms explained by a cause are not double-counted; "View with estimated fix" re-checks the corrected map without changing the file.
- Views: defects, die heatmap, wafer overlay, die overlay (density of all dies folded into one), compare two files (only A · only B · common, plus map-definition diff). Filters, tables, PNG · CSV · JSON export.
- Field validation: a repro set with one synthetic map error per file; draft rules compared on the same set, run in shadow, switched and rolled back.
- Not found among the products surveyed (Nov 2026): reading both KLARF 1.2 and 1.8 locally in the browser (semitool and WaferScope have no 1.8 record-format support, per their public code); reporting map-definition errors against the defect layout when a file opens.
- 1 million defects open in 2.3–2.8 s and pan at 164–165 fps (Chrome, WebGL). All five synthetic map errors detected, zero false alarms on 24 normal synthetic wafers.
- Live demo: https://mhbae-semi-lab.github.io/klarf-viewer/
- Run locally: `python -m http.server 8753 --bind 127.0.0.1`, tests: `node --test`.
- Built by 배민혁 with an AI coding assistant (Claude Code). All sample data is synthetic. MIT License.
