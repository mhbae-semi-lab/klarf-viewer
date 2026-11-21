# KLARF 형식 메모 (공개 자료 기준)

KLA 의 공식 명세서는 공개되어 있지 않습니다. 이 앱의 파서는 아래 공개 오픈소스의 코드 · 시험 파일만 보고 만들었고, 시험용 파일은 모두 `src/gen.js` 가 만든 합성 파일입니다. 실제 장비 파일은 열어 보지 않았습니다 (2026-11 확인).

| 출처 | 언어 · 라이선스 | 읽는 버전 | 참고한 것 |
|---|---|---|---|
| [btrapp/jklarfreader](https://github.com/btrapp/jklarfreader) | Java · MIT | 1.2(웨이퍼 1장) · 1.8 | 1.8 문법(Record · Field · List), 1.2 ↔ 1.8 필드 대응표, nm 단위 |
| [MichaelHotaling/klarfkit](https://github.com/MichaelHotaling/klarfkit) | Python · MIT | 1.x 평면형 | 웨이퍼 좌표 식, XREL 범위, 시험 파일의 방언(대소문자 · 날짜 형식) |
| [Impro02/klarf_reader](https://github.com/Impro02/klarf_reader) | Python · MIT | 1.1 · 1.2 | 웨이퍼 여러 장, 같은 좌표 식 |
| [hadriman/klarfio](https://github.com/hadriman/klarfio) | Python · GPL-3.0 | 1.2 · 1.8 | 시험 파일 구조 (코드는 가져오지 않음) |
| [banickn/klarfrs](https://github.com/banickn/klarfrs) | Rust · MIT | 1.2 | DefectList 읽기 방식 |

## 1.1 · 1.2 (평면형)
- 문장마다 `키워드 값… ;`. 키워드는 대소문자를 가리지 않는다. 문자열은 큰따옴표.
- `ClassLookup N` · `SampleTestPlan N` 등은 개수 다음에 한 줄씩, 마지막 줄 끝에 `;`.
- `DefectList` 는 개수가 없고 마지막 행 뒤의 `;` 에서 끝난다. 행이 줄을 넘을 수 있다. 사이에 `TiffFileName x.jpg;` 같은 줄이 낄 수 있다.
- `IMAGELIST` 칸은 `n` 다음에 `n` 쌍(이미지 번호, 종류). 예: `… 1 1 1 0`(이미지 1개), `… 0 0`(없음).
- 길이 µm, 넓이 µm², `SampleSize 1 300` = 모양 코드 + 지름 mm.
- 웨이퍼가 여러 장이면 `WaferID` 부터 `SummaryList` 까지가 반복되고 `EndOfFile;` 은 한 번.

## 1.8 (레코드형)
- `Record FileRecord "1.8" { … }` 안에 `Record LotRecord`, 그 안에 `Record WaferRecord`.
- `Field 이름 개수 {값, 값}`, `List 이름 { Columns n { 형 이름, … } Data m { 값 값; … } }`.
- 길이는 nm 정수(이 앱은 `SampleSize` 가 1e5 보다 크면 nm 로 본다). `OrientationMarkLocation` 은 각도: DOWN=0, LEFT=90, UP=180, RIGHT=270.
- 목록형 열(`ImageList`)은 `N` 또는 `Images k { … }`. 이 앱은 개수만 읽는다.
- 필드와 하위 레코드의 순서는 자유.

## 좌표
- 웨이퍼 중심 기준: `X = XINDEX × DiePitchX + XREL − SampleCenterLocationX` (Y 도 같음). klarfkit · klarf_reader 가 같은 식을 쓴다.
- `0 ≤ XREL < DiePitchX` 이어야 앞뒤가 맞는다 (klarfkit 의 역변환).
- `DieOrigin` 은 공개 구현들이 계산에 쓰지 않고, 공개 시험 파일은 모두 `0 0` 이다. 이 앱도 쓰지 않고 0 이 아니면 주의를 표시한다.
- +Y 가 위쪽이라고 보았다 (공개 문서에 명시는 없음). `CoordinatesMirrored` · `InspectionOrientation` 은 의미를 공개 자료에서 확인하지 못해 적용하지 않는다.
