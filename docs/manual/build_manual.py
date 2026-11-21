# -*- coding: utf-8 -*-
"""Klarf 웨이퍼 맵 뷰어 사용자 매뉴얼(PPTX) 생성기. llm-pulse docs/manual/build_manual.py 양식(log-analyzer 판)을 이 앱에 맞게 고쳐 쓴다.

    python docs/manual/build_manual.py

스크린샷은 docs/manual/capture.mjs 로 만든 shots/*.png (1280x800 CSS px, 배율 1.5) 와
말풍선 자리 shots/marks.json (CSS px 사각형) 을 쓴다. 화면은 모두 합성 데이터다.
"""
import json
import os
import sys

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
ASSETS = os.path.join(HERE, "assets")
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "Klarf-Viewer-User-Manual-ko.pptx")
VERSION = "1.0.0"
DATE = "2026.11.22"
NAME = "Klarf 웨이퍼 맵 뷰어"
MARKS = json.load(open(os.path.join(SHOTS, "marks.json"), encoding="utf-8"))
DIP = (1280, 800)

# ---------------------------------------------------------------- 디자인 토큰 (llm-pulse 매뉴얼과 같음, 강조색만 앱 색)
INK = RGBColor(0x1F, 0x29, 0x37)
SUB = RGBColor(0x5B, 0x65, 0x73)
BLUE = RGBColor(0xC0, 0x00, 0x00)
NAVY = RGBColor(0x14, 0x14, 0x18)
CARD = RGBColor(0xF3, 0xF5, 0xF8)
LINE = RGBColor(0xD9, 0xDE, 0xE5)
AMBER = RGBColor(0xE5, 0xA0, 0x2D)
AMBER_BG = RGBColor(0xFF, 0xF6, 0xE5)
AMBER_TX = RGBColor(0x7A, 0x4E, 0x00)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SOFT = RGBColor(0xF2, 0xB8, 0xB8)
FONT = "맑은 고딕"
MONO = "Consolas"

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
TOTAL = 30
state = {"n": 0}


def new_slide():
    state["n"] += 1
    return prs.slides.add_slide(prs.slide_layouts[6])


def box(s, x, y, w, h, fill=None, line=None, shape=MSO_SHAPE.RECTANGLE, radius=None, lw=0.75):
    sh = s.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line
        sh.line.width = Pt(lw)
    sh.shadow.inherit = False
    if radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        sh.adjustments[0] = radius
    return sh


def rbox(s, x, y, w, h, fill=CARD, line=None, radius=0.03, lw=0.75):
    return box(s, x, y, w, h, fill, line, MSO_SHAPE.ROUNDED_RECTANGLE, radius, lw)


def text(s, x, y, w, h, t, size=12, bold=False, color=INK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         shape=None, font=FONT, spacing=None):
    tb = shape or s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.05)
    tf.margin_top = tf.margin_bottom = Inches(0.02)
    tf.vertical_anchor = anchor
    lines = t if isinstance(t, list) else [t]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if spacing:
            p.line_spacing = spacing
        r = p.add_run()
        r.text = line
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
        r.font.name = font
    return tb


def num_circle(s, x, y, n, d=0.3, size=11):
    c = box(s, x, y, d, d, fill=BLUE, line=WHITE, shape=MSO_SHAPE.OVAL, lw=1.5)
    text(s, 0, 0, 0, 0, str(n), size, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=c)
    c.text_frame.margin_left = c.text_frame.margin_right = 0
    return c


# ---------------------------------------------------------------- 공통 틀
def header(s, section, title, bullets):
    pill = box(s, 10.2, 0.0, 2.7, 0.34, fill=BLUE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.3)
    text(s, 0, 0, 0, 0, section, 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=pill)
    text(s, 0.45, 0.32, 11.5, 0.6, f"[Klarf 뷰어] {title}", 28, True)
    box(s, 0.5, 1.0, 0.9, 0.06, fill=BLUE)
    for i, t in enumerate(bullets):
        box(s, 0.55, 1.37 + i * 0.36, 0.07, 0.07, fill=BLUE, shape=MSO_SHAPE.OVAL)
        text(s, 0.72, 1.24 + i * 0.36, 12.1, 0.32, t, 13.5)
    footer(s)


def footer(s):
    box(s, 0.5, 7.05, 12.33, 0.01, fill=LINE)
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(0.5), Inches(7.12), Inches(0.22), Inches(0.22))
    text(s, 0.78, 7.1, 6, 0.25, f"{NAME} 사용자 매뉴얼  ·  v{VERSION}  ·  배민혁", 9, False, SUB)
    text(s, 11.8, 7.1, 1.03, 0.25, f"{state['n']} / {TOTAL}", 9, True, SUB, PP_ALIGN.RIGHT)


# ---------------------------------------------------------------- 스크린샷 카드
def load_shot(name, crop=None, dip=DIP):
    """crop: CSS px 사각형 (x0,y0,x1,y1). 반환: (경로, 크기, 오프셋)"""
    path = os.path.join(SHOTS, f"{name}.png")
    im = Image.open(path)
    k = im.width / dip[0]
    if not crop:
        return path, dip, (0, 0)
    os.makedirs(CACHE, exist_ok=True)
    x0, y0, x1, y1 = crop
    out = os.path.join(CACHE, f"{name}_{x0}_{y0}_{x1}_{y1}.png")
    im.crop((round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))).save(out, optimize=True)
    return out, (x1 - x0, y1 - y0), (x0, y0)


def M(name, *idx):
    """marks.json 에서 말풍선 자리 고르기 (숫자 대신 사각형을 직접 줄 수도 있음)"""
    out = []
    for i in idx:
        r = MARKS[name][i] if isinstance(i, int) else i
        if r:
            out.append(tuple(r))
    return out


def shot_card(s, x, y, w, h, title, name, callouts=(), crop=None, dip=DIP, d=0.24):
    rbox(s, x, y, w, h)
    text(s, x + 0.15, y + 0.1, w - 0.3, 0.32, title, 13, True)
    path, (dw, dh), (ox, oy) = load_shot(name, crop, dip)
    bw, bh = w - 0.4, h - 0.82  # 아래 0.2in 는 "합성 데이터" 표기 자리
    k = min(bw / dw, bh / dh)
    iw, ih = dw * k, dh * k
    ix, iy = x + (w - iw) / 2, y + 0.5
    box(s, ix - 0.02, iy - 0.02, iw + 0.04, ih + 0.04, fill=WHITE, line=LINE)
    s.shapes.add_picture(path, Inches(ix), Inches(iy), Inches(iw), Inches(ih))
    for n, r in enumerate(callouts, 1):
        x0, y0, x1, y1 = r
        x0, y0, x1, y1 = max(x0, ox), max(y0, oy), min(x1, ox + dw), min(y1, oy + dh)
        box(s, ix + (x0 - ox) * k, iy + (y0 - oy) * k, max(0.05, (x1 - x0) * k), max(0.05, (y1 - y0) * k), fill=None, line=BLUE,
            shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08, lw=1.75)
        c = box(s, ix + (x0 - ox) * k - d / 2, iy + (y0 - oy) * k - d / 2, d, d, fill=BLUE, line=WHITE,
                shape=MSO_SHAPE.OVAL, lw=1.25)
        text(s, 0, 0, 0, 0, str(n), 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=c)
        c.text_frame.margin_left = c.text_frame.margin_right = 0
    text(s, x + w - 3.0, y + h - 0.27, 2.85, 0.22, "※ 합성 데이터로 찍은 화면", 8.5, False, SUB, PP_ALIGN.RIGHT)


def steps_card(s, x, y, w, h, steps, title="사용 순서", tip=None, desc_size=10):
    rbox(s, x, y, w, h)
    text(s, x + 0.15, y + 0.1, w - 0.3, 0.32, title, 13, True)
    n = len(steps)
    top = y + 0.52
    avail = h - 0.52 - (0.62 if tip else 0.15)
    pitch = min(0.8, avail / n)
    for i, (hd, ds) in enumerate(steps):
        yy = top + i * pitch
        num_circle(s, x + 0.2, yy + 0.03, i + 1)
        text(s, x + 0.62, yy - 0.02, w - 0.8, 0.28, hd, 12, True)
        text(s, x + 0.62, yy + 0.24, w - 0.8, pitch - 0.22, ds, desc_size, False, SUB)
    if tip:
        t = rbox(s, x + 0.15, y + h - 0.55, w - 0.3, 0.42, fill=AMBER_BG, line=AMBER, radius=0.15)
        text(s, 0, 0, 0, 0, "Tip  " + tip, 9.5, False, AMBER_TX, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, shape=t)
        t.text_frame.margin_left = Inches(0.12)


CY, CH = 2.45, 4.5      # 카드 영역
LX, LW = 0.5, 7.0       # 왼쪽(스크린샷) 카드
RX, RW = 7.65, 5.18     # 오른쪽(순서) 카드


def shot_steps(section, title, bullets, shot, callouts, steps, tip=None, card_title=None, crop=None, desc_size=10):
    s = new_slide()
    header(s, section, title, bullets)
    shot_card(s, LX, CY, LW, CH, card_title or title, shot, callouts, crop)
    steps_card(s, RX, CY, RW, CH, steps, tip=tip, desc_size=desc_size)
    return s



def wafer_art(s, cx, cy, r, dark=True):
    """표지용 웨이퍼 그림: 다이 격자 + 결함 점 (합성)"""
    import random
    rnd = random.Random(20261122)
    edge = RGBColor(0x3A, 0x3A, 0x44) if dark else LINE
    box(s, cx - r, cy - r, 2 * r, 2 * r, fill=RGBColor(0x22, 0x22, 0x28) if dark else CARD, line=edge, shape=MSO_SHAPE.OVAL, lw=1.5)
    p = r / 7.5
    for i in range(-8, 8):
        for j in range(-8, 8):
            x0, y0 = cx + i * p, cy + j * p
            far = max(((x0 + dx - cx) ** 2 + (y0 + dy - cy) ** 2) ** 0.5 for dx in (0, p) for dy in (0, p))
            if far < r * 0.98:
                box(s, x0 + 0.01, y0 + 0.01, p - 0.02, p - 0.02, fill=RGBColor(0x2C, 0x2C, 0x34) if dark else WHITE)
    cols = [RGBColor(0x39, 0x87, 0xE5), RGBColor(0xD9, 0x59, 0x26), RGBColor(0x19, 0x9E, 0x70), RGBColor(0xC9, 0x85, 0x00)]
    for _ in range(160):
        while True:
            x, y = (rnd.random() * 2 - 1) * r, (rnd.random() * 2 - 1) * r
            if x * x + y * y < (r * 0.95) ** 2:
                break
        box(s, cx + x, cy + y, 0.035, 0.035, fill=cols[rnd.randrange(4)], shape=MSO_SHAPE.OVAL)
    box(s, cx - 0.08, cy + r - 0.08, 0.16, 0.16, fill=NAVY if dark else WHITE, line=edge, shape=MSO_SHAPE.OVAL)


# ================================================================ 1. 표지
def cover():
    s = new_slide()
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = NAVY
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(0.8), Inches(0.9), Inches(0.9), Inches(0.9))
    text(s, 0.75, 2.0, 7, 1.0, NAME, 42, True, WHITE)
    text(s, 0.8, 3.0, 7, 0.6, "사용자 매뉴얼", 26, False, SOFT)
    box(s, 0.85, 3.75, 0.9, 0.06, fill=BLUE)
    text(s, 0.8, 3.95, 6.0, 0.9, ["결함을 보기 전에 맵 정의부터 —", "KLARF 1.2 · 1.8 을 브라우저에서 여는 웨이퍼 맵 뷰어"], 15, False, RGBColor(0xC9, 0xD3, 0xE0))
    text(s, 0.8, 4.85, 7, 0.3, f"Version {VERSION}   ·   {DATE}   ·   배민혁", 11, False, RGBColor(0x8A, 0x97, 0xA8))
    path, _, _ = load_shot("Map")
    box(s, 6.88, 0.78, 6.0, 3.77, fill=None, line=RGBColor(0x3A, 0x3A, 0x44), lw=1.5)
    s.shapes.add_picture(path, Inches(6.9), Inches(0.8), Inches(5.96), Inches(3.725))
    wafer_art(s, 9.88, 6.0, 1.1)


# ================================================================ 2. 목차
def toc():
    s = new_slide()
    pill = box(s, 10.2, 0.0, 2.7, 0.34, fill=BLUE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.3)
    text(s, 0, 0, 0, 0, "목차", 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=pill)
    text(s, 0.45, 0.32, 11.5, 0.6, "목차", 28, True)
    box(s, 0.5, 1.0, 0.9, 0.06, fill=BLUE)
    text(s, 0.55, 1.2, 12, 0.35, "처음 쓰는 분은 1~2번, 필요한 화면만 찾는 분은 오른쪽 쪽수를 보세요.", 13.5, False, SUB)
    groups = [
        ("1", "시작하기", [("3", "이 앱이 푸는 문제"), ("4", "설치와 첫 실행"), ("5", "화면 구성"), ("6", "웨이퍼 맵")]),
        ("2", "맵 정의 검증", [("7", "5가지 한눈에"), ("8–9", "pitch · 고쳐 보기"), ("10–11", "스크라이브 · 원점 다이"), ("12–13", "웨이퍼 밖 · 다이 인덱스")]),
        ("3", "보기 · 비교", [("14", "다이 히트맵"), ("15", "웨이퍼 겹치기 · 반복 결함"), ("16", "다이 겹치기"), ("17", "두 파일 비교"), ("18", "필터 · 표 · 내보내기")]),
        ("4", "현장 검증 절차", [("19", "4단계 한눈에"), ("20", "재현"), ("21", "비교"), ("22", "Shadow"), ("23", "전환 · 롤백")]),
        ("5", "내 데이터 · 부록", [("24", "읽는 형식"), ("25", "읽지 못한 줄 · 오류 메시지"), ("26", "개인정보 · 저장"), ("27–28", "영어 · 모바일 · 큰 파일"), ("29–30", "FAQ · 버전 정보")]),
    ]
    pos = [(0.5, 1.9, 3.95, 2.45), (4.69, 1.9, 3.95, 2.45), (8.88, 1.9, 3.95, 2.45),
           (0.5, 4.5, 6.05, 2.4), (6.78, 4.5, 6.05, 2.4)]
    for (no, name, items), (x, y, w, h) in zip(groups, pos):
        rbox(s, x, y, w, h)
        num_circle(s, x + 0.2, y + 0.2, no, 0.38, 13)
        text(s, x + 0.7, y + 0.2, w - 0.9, 0.4, name, 16, True, anchor=MSO_ANCHOR.MIDDLE)
        for i, (pg, nm) in enumerate(items):
            yy = y + 0.74 + i * 0.32
            text(s, x + 0.3, yy, 0.9, 0.3, pg, 11.5, True, BLUE)
            text(s, x + 1.2, yy, w - 1.4, 0.3, nm, 11.5, False, INK)
    footer(s)


# ================================================================ 3. 소개
def intro():
    s = new_slide()
    header(s, "시작하기", "이 앱이 푸는 문제", [
        "관점: 레시피와 맵을 만들던 사람의 눈으로 본 결함 파일 뷰어. 결함을 보기 전에 맵 정의가 맞는지부터 확인한다",
        "해결: 장비 PC 가 아닌 아무 PC 에서나 Klarf 를 열어 웨이퍼 맵 · 결함 분포를 보고, 두 파일을 비교한다",
        "서버 없이 브라우저에서 동작하고, 파일은 이 기기 밖으로 나가지 않는다",
    ])
    cards = [
        ("맵 정의 검증 5가지", "pitch · 스크라이브 · 원점 다이 · 웨이퍼 밖 결함 · 다이 인덱스를 결함 배열과 대조합니다. 원인을 추정하면 고쳐 본 맵을 다시 검증합니다."),
        ("보기 5가지", "결함 · 다이 히트맵 · 웨이퍼 겹치기 · 다이 겹치기 · 두 파일 비교. 결함 100만 개도 몇 초 안에 열고 끊김 없이 움직입니다."),
        ("현장 검증 절차", "검증 규칙을 바꾸기 전에 맵 오류 재현 세트로 확인하고, 새 규칙은 Shadow 로 먼저 돌린 뒤 전환 · 롤백합니다."),
    ]
    for i, (hd, ds) in enumerate(cards):
        x = 0.5 + i * 4.19
        rbox(s, x, 2.45, 3.95, 1.95)
        num_circle(s, x + 0.2, 2.65, i + 1, 0.36)
        text(s, x + 0.68, 2.64, 3.1, 0.38, hd, 15, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.25, 3.18, 3.5, 1.1, ds, 11, False, SUB)
    text(s, 0.5, 4.62, 6, 0.3, "파일이 판단이 되기까지", 13, True)
    flow = [
        ("Klarf 열기", ["1.1 · 1.2 평면형", "1.8 레코드형 (nm → µm)"]),
        ("맵 정의 검증", ["결함 배열과 대조", "원인 추정 · 고쳐 보기"]),
        ("보기 · 비교", ["히트맵 · 겹치기", "두 파일 비교 · 표"]),
        ("현장 검증", ["재현 → 비교", "Shadow → 전환 · 롤백"]),
    ]
    w, gap = 2.78, 0.4
    for i, (hd, ln) in enumerate(flow):
        x = 0.5 + i * (w + gap)
        hl = i == 1
        rbox(s, x, 5.0, w, 1.75, fill=WHITE if hl else CARD, line=BLUE if hl else None, radius=0.04, lw=2)
        text(s, x + 0.1, 5.1, w - 0.2, 0.4, hd, 14, True, BLUE if hl else INK, PP_ALIGN.CENTER)
        text(s, x + 0.1, 5.6, w - 0.2, 1.0, ln, 10.5, False, SUB, PP_ALIGN.CENTER)
        if i < 3:
            box(s, x + w + 0.06, 5.72, gap - 0.12, 0.34, fill=BLUE, shape=MSO_SHAPE.RIGHT_ARROW)


# ================================================================ 4. 설치
def install():
    s = new_slide()
    header(s, "시작하기", "설치와 첫 실행", [
        "웹 주소를 열면 바로 쓸 수 있고, 브라우저의 '앱 설치'로 PWA 로 설치하면 오프라인에서도 열림",
        "처음 열면 안내 창과 합성 예시 Klarf 가 함께 열려, 내 파일 없이도 모든 기능을 둘러볼 수 있음",
        "서버가 없으므로 계정 · 로그인이 없음. 데이터는 이 브라우저(IndexedDB)에만 저장",
    ])
    steps_card(s, 0.5, CY, 6.0, CH, [
        ("주소 열기", "https://mhbae-semi-lab.github.io/klarf-viewer/  (Chrome · Edge · Firefox 최신판, WebGL 이 켜져 있어야 빠릅니다)"),
        ("앱 설치 (선택)", "주소창 오른쪽 '앱 설치' 아이콘 → 설치. 시작 메뉴 · 바탕 화면에서 창으로 열립니다."),
        ("첫 실행 안내", "예시 Klarf · 내 Klarf · 두 파일 비교를 안내합니다. [시작하기]로 닫습니다."),
        ("내 PC 에서 직접 실행", "저장소 폴더에서  python -m http.server 8753 --bind 127.0.0.1  → http://127.0.0.1:8753/"),
    ], title="설치 순서", tip="새 버전이 나오면 화면 아래에 '다시 읽기' 안내가 뜹니다", desc_size=10.5)
    shot_card(s, 6.75, CY, 6.08, CH, "첫 실행 안내", "Onboard", crop=(320, 180, 960, 560))


# ================================================================ 본문
def screens():
    shot_steps("시작하기", "화면 구성", [
        "오른쪽 위: 언어(한국어 · English) · 테마(자동 · 밝게 · 어둡게) · 도움말 · 설정",
        "위에서 아래로: Klarf 열기 → 웨이퍼 맵 + 맵 정의 검증 · 필터 · 파일 정보 → 표 → 현장 검증 절차",
        "단축키  ?  도움말. 파일은 여러 개를 한꺼번에 끌어다 놓아도 됨",
    ], "Home", M("Home", 4, 5, 6, 7, 0, 3), [
        ("예시 고르기", "정상 · 맵 오류 5종 · 깨진 파일 · 두 파일 비교 · 100만 개"),
        ("예시 열기", "고른 합성 예시를 엽니다. 처음에는 '정상 · 1.2' 가 열려 있습니다"),
        ("내 Klarf 열기", "파일을 고르거나 페이지에 끌어다 놓습니다 (여러 개 가능)"),
        ("열린 파일", "형식 · 웨이퍼별 결함 수 · 오류 수(!) · 읽기 시간. 웨이퍼를 눌러 바꿉니다"),
        ("언어", "화면 · 검증 문구가 함께 바뀝니다"),
        ("설정", "점 크기 · 표 줄 수 · 반복 결함 거리 · 백업"),
    ], tip="새로고침해도 마지막으로 연 파일(합계 200MB 미만) · 보기 · 필터가 다시 열립니다", card_title="첫 화면", desc_size=9.5)

    shot_steps("시작하기", "웨이퍼 맵", [
        "웨이퍼 원 · 노치 · 다이 격자(DiePitch) · 테스트 플랜 다이(옅은 칠) 위에 결함을 클래스 색으로 그림",
        "끌어서 이동 · 휠이나 두 손가락으로 확대 · 더블클릭 전체. 결함을 누르면 결함 표의 그 행으로",
        "웨이퍼 좌표 = XINDEX × DiePitch + XREL − SampleCenterLocation (µm, 위쪽이 +Y)",
    ], "Map", M("Map", 0, 1, 2, 3, 4), [
        ("보기", "결함 · 다이 히트맵 · 웨이퍼 겹치기 · 다이 겹치기 · 두 파일 비교"),
        ("지도", "마우스를 올리면 다이 번호와 가까운 결함 정보"),
        ("맵 정의 검증", "파일을 열 때마다 자동으로 돕니다"),
        ("클래스 필터", "ClassLookup 이름 · 색 · 개수. 끄면 지도와 표에서 빠집니다"),
        ("범례", "보기마다 색의 뜻"),
    ], tip="키보드: 지도에 초점을 두고 ← → ↑ ↓ 이동, + − 확대 · 축소, 0 전체", card_title="웨이퍼 맵")


def checks_overview():
    s = new_slide()
    header(s, "맵 정의 검증", "5가지 한눈에", [
        "파일을 열 때마다 돌고, 오류마다 '지도에서 보기'로 걸린 다이 · 결함을 강조",
        "원인으로 설명되는 증상은 따로 세지 않음 (예: 원점이 어긋나 웨이퍼 밖으로 보이는 결함)",
        "결함이 적거나 신호가 없으면 판정하지 않고 '참고'로 적음 — 오검 대신 판정 보류",
    ])
    items = [
        ("pitch", "결함 위치의 다이 주기", "결함의 웨이퍼 좌표를 X · Y 로 모아 선언 pitch ±5% 안에서 주기를 찾습니다. 1% 넘게 다르면 오류."),
        ("스크라이브", "격자 원점 (위상)", "모든 결함을 한 다이에 겹쳐 결함 없는 띠를 찾습니다. 띠가 다이 경계가 아닌 안쪽이면 오류."),
        ("원점 다이", "웨이퍼 중심 · 원점", "테스트 플랜 다이가 웨이퍼 원 밖에 통째로 있으면 오류. 몇 다이 옮기면 맞는지 함께."),
        ("웨이퍼 밖", "반지름 + 여유 500 µm", "웨이퍼 원 밖 결함. SampleSize · 중심 · 가장자리 오검출을 확인합니다."),
        ("다이 인덱스", "XREL · XINDEX · 플랜", "XREL · YREL 이 0 ~ pitch 밖이거나 결함 다이가 플랜에 없으면 오류. 맞는 이동량을 함께."),
    ]
    w = 2.35
    for i, (hd, sub, ds) in enumerate(items):
        x = 0.5 + i * (w + 0.145)
        rbox(s, x, 2.55, w, 4.25, fill=WHITE, line=LINE, radius=0.04, lw=1.2)
        num_circle(s, x + 0.18, 2.72, i + 1, 0.4, 13)
        text(s, x + 0.68, 2.72, w - 0.8, 0.4, hd, 15, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.18, 3.3, w - 0.36, 0.6, sub, 11.5, True, BLUE)
        text(s, x + 0.18, 3.95, w - 0.36, 2.7, ds, 11, False, SUB)


def checks():
    SEC = "맵 정의 검증"
    shot_steps(SEC, "① pitch", [
        "예시 '맵 오류 ① pitch': 검사기가 DiePitch X 를 9,840 µm(실제 9,600)로 잡고 좌표를 계산한 파일",
        "파일 안에서는 앞뒤가 맞아 보여도, 결함 위치의 다이 주기는 9,600 µm 로 나옴 → −2.44%",
        "'지도에서 보기'는 다이 겹치기로 바뀜: 레티클 반복 결함이 점이 아니라 줄무늬로 번짐",
    ], "Pitch", M("Pitch", 0, 1, 2, 3), [
        ("오류 내용", "선언 pitch · 실측 주기 · 차이(%) · 주기 신호 세기"),
        ("지도에서 보기", "다이 겹치기로 전환합니다"),
        ("다이 겹치기", "pitch 가 틀리면 반복 결함이 가로 줄무늬가 됩니다"),
        ("추정값으로 고쳐 보기", "실측 주기로 격자를 다시 잡아 검증합니다"),
    ], tip="주기 신호 세기는 잡음 = 1 기준. 8 보다 약하면 판정하지 않습니다", card_title="pitch 불일치")

    shot_steps(SEC, "고쳐 보기", [
        "'추정값으로 고쳐 보기'는 추정한 원인(pitch · 격자 원점 · 원점 다이 · 인덱스 이동)을 적용한 맵을 보여주고 다시 검증",
        "pitch · 스크라이브는 결함의 웨이퍼 좌표는 두고 격자만 새로 잡아 XINDEX · XREL · 테스트 플랜을 다시 계산",
        "파일은 바꾸지 않음. '원래대로 보기'로 돌아감",
    ], "PitchFixed", M("PitchFixed", 0, 1, 2), [
        ("다시 검증", "고친 맵에서 오류 0 → 원인 추정이 맞다는 근거"),
        ("원래대로 보기", "파일 그대로의 맵으로 돌아갑니다"),
        ("다이 겹치기", "반복 결함이 다시 점 3개로 모입니다"),
    ], tip="합성 오류 4종(pitch · 스크라이브 · 원점 · 인덱스)은 고쳐 보면 모두 오류 0 이 됩니다", card_title="고쳐 본 맵")

    shot_steps(SEC, "② 스크라이브 · 격자 원점", [
        "예시 '맵 오류 ② 스크라이브': 격자 원점이 X 로 2.4 mm 밀려 다이 경계가 스크라이브를 벗어난 파일",
        "검사하지 않은 스크라이브는 결함이 없는 띠로 보임. 그 띠가 다이 안쪽 7,152 ~ 7,248 µm 에 있음",
        "띠가 다이 경계를 감싸면 정상. 스크라이브까지 검사한 파일은 띠가 없어 판정하지 않음",
    ], "Scribe", M("Scribe", 0, 1), [
        ("오류 내용", "띠 위치 · 경계에서 떨어진 거리 · 추정 원점 어긋남"),
        ("빨간 띠", "다이 겹치기 위에 결함 없는 띠를 표시합니다"),
    ], card_title="스크라이브 위치 어긋남")

    shot_steps(SEC, "③ 원점 다이 · 웨이퍼 중심", [
        "예시 '맵 오류 ③ 원점 다이': SampleCenterLocation 이 한 다이씩 어긋난 파일",
        "테스트 플랜 다이 44개가 웨이퍼 원 밖에 통째로 있음 → 맵을 (+1, −1) 다이 옮기면 맞음",
        "그 때문에 웨이퍼 밖으로 보이는 결함 393개는 '참고'로만 적고 따로 오류로 세지 않음",
    ], "Origin", M("Origin", 0, 1, 2), [
        ("오류 내용", "밖으로 나간 플랜 다이 수와 맞는 이동량"),
        ("설명된 증상", "원인을 고치면 사라지는 증상"),
        ("빨간 칸", "웨이퍼 원 밖에 통째로 있는 플랜 다이"),
    ], card_title="원점 다이 · 웨이퍼 중심 어긋남")

    shot_steps(SEC, "④ 웨이퍼 밖 결함", [
        "예시 '맵 오류 ④ 웨이퍼 밖': 가장자리 부분 다이 안, 웨이퍼 원 밖 1 ~ 3 mm 에 결함 50개",
        "반지름 + 여유(기본 500 µm) 밖 결함을 셈. 원점 · 인덱스 오류로 설명되는 것은 빼고 셈",
        "SampleSize(웨이퍼 크기) · 중심 · 가장자리 오검출을 확인할 신호",
    ], "Outside", M("Outside", 0, 1), [
        ("오류 내용", "개수 · 기준 반지름 · 가장 먼 결함"),
        ("빨간 원", "웨이퍼 밖 결함과 기준 원"),
    ], tip="고쳐 보기로도 남는 오류입니다 (진짜로 원 밖에 있는 결함)", card_title="웨이퍼 밖 결함")

    shot_steps(SEC, "⑤ 다이 인덱스", [
        "예시 '맵 오류 ⑤ 다이 인덱스': 결함의 XINDEX 만 1 크게 쓴 파일 (테스트 플랜은 그대로)",
        "테스트 플랜에 없는 다이의 결함 99개 → 결함 인덱스를 (−1, 0) 옮기면 플랜과 맞음",
        "XREL · YREL 이 0 ~ pitch 를 벗어난 결함도 같은 오류로 셈",
    ], "Index", M("Index", 0, 1), [
        ("오류 내용", "범위를 벗어난 결함 · 플랜 밖 다이 결함 · 맞는 이동량"),
        ("빨간 원", "플랜 밖 다이에 있는 결함 (오른쪽 끝 열)"),
    ], tip="다이 표의 '플랜' 열에서 플랜에 없는 다이를 바로 찾을 수 있습니다", card_title="다이 인덱스 불일치")


def views():
    SEC = "보기 · 비교"
    shot_steps(SEC, "다이 히트맵", [
        "다이마다 결함 수를 한 색(파랑) 밝기로. 많을수록 짙음 (로그 눈금)",
        "필터(클래스 · 크기 · 검증에 걸린 결함)를 적용한 결함만 셈",
        "다이 표에서 결함 수 순서 · 플랜 여부 · 많은 클래스를 같은 내용으로 볼 수 있음",
    ], "Heat", M("Heat", 0, 1, 2), [
        ("다이 히트맵", "보기 버튼"),
        ("지도", "다이를 누르면 다이 번호와 결함 수"),
        ("범례", "1 ~ 최대 결함 수"),
    ], card_title="다이 히트맵")

    shot_steps(SEC, "웨이퍼 겹치기 · 반복 결함", [
        "같은 pitch 의 웨이퍼를 모두 겹쳐, 여러 장의 같은 자리(기본 100 µm 안)에 있는 결함을 빨갛게",
        "우연히 겹칠 수 있는 장 수는 결함 밀도로 계산해 문턱을 올림 (3장이면 3장 모두)",
        "반복 결함 표: 다이 반복(레티클 결함 후보)과 웨이퍼 반복(같은 자리, 여러 장)",
    ], "Stack", M("Stack", 0, 1, 2), [
        ("웨이퍼 겹치기", "웨이퍼가 2장 이상 열려 있어야 합니다"),
        ("지도", "회색 = 한 장에만, 빨강 = 여러 장의 같은 자리"),
        ("범례", "겹친 장 수 · 반복 위치 수"),
    ], tip="겹치기 · 반복 결함 검출은 상용 도구에도 있는 기능입니다", card_title="웨이퍼 겹치기")

    shot_steps(SEC, "다이 겹치기", [
        "모든 다이를 한 다이에 겹친 결함 밀도 (XREL · YREL). 반복 결함은 짙은 점, 스크라이브는 빈 띠",
        "pitch 가 틀리면 반복 결함이 줄무늬로, 격자 원점이 틀리면 빈 띠가 다이 안쪽으로",
        "다이 밖으로 나간 상대 좌표(인덱스 오류)는 빨간 점으로 따로 표시",
    ], "DieStack", M("DieStack", 0, 1), [
        ("다이 겹치기", "다이 한 개 크기의 밀도 그림"),
        ("범례", "칸당 결함 수 (로그 눈금)"),
    ], tip="맵 정의 검증의 pitch · 스크라이브 판정을 눈으로 확인하는 화면입니다", card_title="다이 겹치기")

    shot_steps(SEC, "두 파일 비교", [
        "A · B 웨이퍼를 고르면 짝 거리(기본 20 µm) 안의 결함을 1:1 로 짝지어 공통 · A 에만 · B 에만으로",
        "예시 '두 파일 비교': 같은 웨이퍼의 세정 전(A) · 후(B). 파랑 = 제거된 결함, 주황 = 새로 생긴 결함",
        "비교 결과 표에서 두 파일의 맵 정의(pitch · 중심 · 플랜 · 노치)가 같은지 먼저 확인",
    ], "Compare", M("Compare", 0, 1), [
        ("A · B · 짝 거리", "열린 웨이퍼 중에서 고릅니다"),
        ("지도", "파랑 A 에만 · 주황 B 에만 · 회색 공통"),
    ], tip="맵 정의가 다르면 비교 결과 표 위에 경고가 나옵니다", card_title="두 파일 비교")

    shot_steps(SEC, "필터 · 표 · 내보내기", [
        "필터: 클래스 켜고 끄기, 크기 최소 · 최대(µm), 검증에 걸린 결함만",
        "결함 표: DEFECTID · 다이 · XREL, YREL · 웨이퍼 좌표 · 클래스 · 크기 · 검증. 행을 누르면 지도에서 그 결함으로",
        "내보내기: PNG(지금 지도) · CSV(필터 적용 결함) · 요약(JSON: 맵 정의 · 클래스 수 · 검증 결과)",
    ], "Filter", M("Filter", 0, 1, 2, 3), [
        ("클래스", "끄면 지도 · 표 · 히트맵 · CSV 에서 빠집니다"),
        ("크기", "DSIZE (없으면 XSIZE · YSIZE 중 큰 값)"),
        ("검증에 걸린 결함만", "웨이퍼 밖 · 인덱스 오류 결함만 남깁니다"),
        ("보이는 결함 수", "필터를 적용한 수 / 전체"),
    ], card_title="필터")


def flow_overview():
    s = new_slide()
    header(s, "현장 검증 절차", "4단계 한눈에", [
        "바꾸기 전에 같은 데이터로 확인하고, 새 방법은 옆에서 먼저 돌려 보고, 언제든 되돌린다",
        "이 앱에서 바꾸는 '방법'은 맵 정의 검증 규칙(허용 차이 · 여유 · 최소 결함 수 8가지)",
        "화면 '현장 검증 절차' 패널의 탭 4개가 이 순서를 그대로 따름 (← → 로 탭 이동)",
    ])
    st = [
        ("재현", "맵 오류 재현 세트를 연다", ["합성 7개 (정상 2 · 오류 5) + 깨진 파일", "내 파일을 라벨과 함께 저장", "잡음 · 놓침 · 오검"]),
        ("비교", "같은 세트에서 A / B 를 나란히", ["B 초안의 허용값을 고침", "바뀐 칸만 빨갛게", "놓침이 생기는지 바로 보임"]),
        ("Shadow", "B 는 옆에서만 돌린다", ["파일을 열 때마다 B 도 실행", "화면 판정은 A", "A 와 다른 결과를 기록"]),
        ("전환 · 롤백", "기준을 넘으면 전환", ["재현 세트 놓침 0 · 오검 0", "Shadow 3건 이상", "모든 버전 한 번에 되돌리기"]),
    ]
    w, gap = 2.85, 0.31
    for i, (hd, sub, items) in enumerate(st):
        x = 0.5 + i * (w + gap)
        rbox(s, x, 2.6, w, 3.9, fill=WHITE, line=BLUE if i == 0 else LINE, radius=0.04, lw=1.5)
        num_circle(s, x + 0.2, 2.8, i + 1, 0.42, 14)
        text(s, x + 0.75, 2.8, w - 0.9, 0.42, hd, 17, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.2, 3.4, w - 0.4, 0.6, sub, 11.5, True, SUB)
        for j, it in enumerate(items):
            box(s, x + 0.25, 4.22 + j * 0.55, 0.07, 0.07, fill=BLUE, shape=MSO_SHAPE.OVAL)
            text(s, x + 0.4, 4.08 + j * 0.55, w - 0.55, 0.5, it, 11)
        if i < 3:
            box(s, x + w + 0.03, 4.3, gap - 0.06, 0.3, fill=BLUE, shape=MSO_SHAPE.RIGHT_ARROW)


def verify():
    SEC = "현장 검증 절차"
    shot_steps(SEC, "① 재현", [
        "재현 세트 = 맵 오류가 하나씩 들어간 합성 파일 + 내가 '있어야 할 오류' 라벨을 붙여 저장한 파일",
        "지금 적용 중인 검증 규칙으로 세트 전체를 다시 검증해 잡음 · 놓침 · 오검을 셈",
        "'지금 파일을 사례로 저장'은 20MB 이하 파일만 (이 브라우저에만 저장)",
    ], "Repro", M("Repro", 0, 1, 2, 3), [
        ("재현 탭", "현장 검증 절차의 첫 단계"),
        ("요약", "잡은 오류 · 놓친 오류 · 오검"),
        ("사례 행", "있어야 할 오류 · 찾은 오류 · 결과. [열기]로 그 파일을 엽니다"),
        ("사례로 저장", "지금 파일 + 있어야 할 맵 오류 체크"),
    ], card_title="재현 세트")

    shot_steps(SEC, "② 비교", [
        "[B 초안 만들기] → B 의 허용값을 고침 → [같은 세트로 비교]",
        "A · B 각각의 잡음 · 놓침 · 오검과, 사례별 찾은 오류를 나란히. 바뀐 칸만 빨갛게",
        "예: pitch 허용 차이 1% → 3% 로 넓히면 pitch 오류(−2.44%)를 놓침",
    ], "CompareRules", M("CompareRules", 0, 1, 2, 3), [
        ("A · 지금 적용", "읽기 전용, 버전 번호와 함께"),
        ("B · 초안", "8가지 허용값을 고칩니다"),
        ("같은 세트로 비교", "재현 세트 전체를 A · B 로 검증합니다"),
        ("바뀐 칸", "B 에서 결과가 달라진 사례"),
    ], card_title="검증 규칙 전후 비교")

    shot_steps(SEC, "③ Shadow", [
        "B 초안이 있으면, 파일을 열 때마다 B 로도 검증하고 결과만 기록 (화면 판정은 계속 A)",
        "기록: 시각 · 파일 · 웨이퍼 · A 결과 · B 결과 · 일치 여부. 다른 경우는 빨갛게",
        "실제 장비 파일에서 B 가 A 와 어떻게 다른지를 전환 전에 모음",
    ], "Shadow", M("Shadow", 0, 1, 2), [
        ("Shadow 탭", "B 초안이 있을 때만 쌓입니다"),
        ("요약", "기록 수 · A 와 일치한 수"),
        ("기록", "최근 100건"),
    ], card_title="Shadow 기록")

    shot_steps(SEC, "④ 전환 · 롤백", [
        "전환 조건: 재현 세트에서 B 가 놓침 0 · 오검 0, 그리고 Shadow 기록 3건 이상",
        "[B 로 전환]은 새 버전으로 저장되고, 열린 파일을 모두 새 규칙으로 다시 검증",
        "변경 이력의 [이 버전으로 되돌리기]로 언제든 이전 규칙으로. 되돌림도 새 버전으로 남음",
    ], "Switch", M("Switch", 0, 1, 2), [
        ("조건 진행", "초록 = 통과, 빨강 = 아직"),
        ("B 로 전환", "조건을 넘을 때만 켜집니다"),
        ("변경 이력", "버전 · 시각 · 내용"),
    ], card_title="전환 · 롤백")


def data():
    SEC = "내 데이터 · 부록"
    shot_steps(SEC, "읽는 형식", [
        "KLARF 1.1 · 1.2(평면형): 웨이퍼 여러 장, 시험 여러 개, 줄을 넘는 행, IMAGELIST, TiffFileName 줄, NA",
        "KLARF 1.8(레코드형): Record · Field · List. nm 정수는 µm 로 (SampleSize 로 판단), 노치는 각도 → 방향",
        "형식 근거는 공개 오픈소스(jklarfreader · klarfkit · klarf_reader · klarfio)의 코드 · 시험 파일 (저장소 docs/klarf-format.md)",
    ], "Info", M("Info", 0), [
        ("파일 · 맵 정의", "형식 · Lot · Device · Step · Setup · 검사기 · 웨이퍼 · 노치 · DiePitch · 중심 · 플랜 · 결함 수"),
        ("필수 열", "DefectRecordSpec(1.8 은 Columns)에 XREL · YREL · XINDEX · YINDEX"),
        ("쓰지 않는 값", "DieOrigin(0 이 아니면 주의 표시) · CoordinatesMirrored · InspectionOrientation"),
        ("확장자", "상관없음 (.000 · .001 · .klarf · .klf …). 내용으로 판단합니다"),
    ], card_title="파일 · 맵 정의", crop=(820, 0, 1280, 800), desc_size=9.5)

    shot_steps(SEC, "읽지 못한 줄 · 오류 메시지", [
        "읽지 못한 줄은 버리지 않고 개수 · 줄 번호 · 사유 · 내용을 보여줌 (최대 1,000건 기록)",
        "나머지 줄은 계속 읽어 맵과 검증을 보여줌. SummaryList 결함 수와 다르면 '주의'",
        "예시 '깨진 파일': 열이 빠진 행 · 숫자 자리에 O · 열이 넘치는 행",
    ], "Broken", M("Broken", 0, 1, 2), [
        ("열린 파일", "읽은 결함 수"),
        ("읽지 못한 줄", "펼치면 파일 · 줄 · 사유 · 내용 표"),
        ("줄별 사유", "열 개수 · 좌표가 숫자가 아님 · ; 없이 끝남 · 필수 열 없음 · KLARF 아님 등"),
    ], card_title="읽지 못한 줄", desc_size=10)

    shot_steps(SEC, "개인정보 · 저장", [
        "Klarf 파일은 이 브라우저 안에서만 읽음. 서버가 없고 외부 오류 수집도 없음. LLM 을 쓰지 않음",
        "저장(IndexedDB): 설정 · 검증 규칙 이력 · Shadow 기록 · 재현 사례 · 마지막으로 연 파일(합계 200MB 미만)",
        "설정 → 데이터: 백업 내보내기 · 가져오기(JSON) · 이 기기의 데이터 모두 지우기",
    ], "Settings", M("Settings", 0, 1, 2, 3, 4), [
        ("결함 점 크기", "지도가 작으면(휴대폰) 자동으로 줄어듭니다"),
        ("다이 반복 거리", "같은 자리로 볼 거리(µm). 우연한 겹침은 자동으로 거릅니다"),
        ("웨이퍼 겹치기 거리", "여러 장의 같은 자리로 볼 거리(µm)"),
        ("백업 내보내기", "설정 · 규칙 이력 · Shadow · 재현 사례 (사례 파일 포함)"),
        ("모두 지우기", "확인 후 이 기기의 저장 데이터를 지웁니다"),
    ], tip="예상치 못한 오류는 도움말 → 오류 기록에 이 기기에만 남습니다", card_title="설정", desc_size=9.5)


def appendix():
    s = new_slide()
    header(s, "내 데이터 · 부록", "영어 · 다크 · 모바일 · 키보드", [
        "오른쪽 위에서 한국어 · English 를 바꾸면 화면 문구와 검증 메시지가 함께 바뀜",
        "테마 버튼: 자동(기기 설정) → 밝게 → 어둡게. 휴대폰 폭에서도 같은 기능",
        "지도 그림은 결함 표 · 다이 표로 같은 내용을 글로 볼 수 있음 (화면 낭독기용)",
    ])
    path, _, _ = load_shot("EnHome")
    rbox(s, 0.5, CY, 6.6, CH)
    text(s, 0.65, CY + 0.1, 6, 0.32, "English", 13, True)
    s.shapes.add_picture(path, Inches(0.7), Inches(CY + 0.5), Inches(6.2), Inches(3.875))
    p2, (dw, dh), _ = load_shot("MobileDark", dip=(390, 844))
    rbox(s, 7.3, CY, 2.3, CH)
    text(s, 7.45, CY + 0.1, 2.0, 0.32, "모바일 · 다크", 13, True)
    s.shapes.add_picture(p2, Inches(7.55), Inches(CY + 0.5), Inches(1.8), Inches(1.8 * dh / dw))
    rbox(s, 9.8, CY, 3.03, CH)
    text(s, 9.95, CY + 0.1, 2.8, 0.32, "단축키", 13, True)
    keys = [("← → ↑ ↓", "지도 이동"), ("+ −", "확대 · 축소"), ("0", "전체 보기"), ("Tab Enter", "표 행 → 지도로"), ("← →", "탭 사이 이동"), ("?", "도움말"), ("Esc", "대화상자 닫기")]
    for i, (k, d) in enumerate(keys):
        yy = CY + 0.6 + i * 0.52
        chip = rbox(s, 9.95, yy, 1.15, 0.36, fill=INK, radius=0.2)
        text(s, 0, 0, 0, 0, k, 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=chip, font=MONO)
        text(s, 11.2, yy, 1.6, 0.36, d, 10.5, False, INK, anchor=MSO_ANCHOR.MIDDLE)


def big():
    shot_steps("내 데이터 · 부록", "큰 파일 · 성능", [
        "예시 '성능 확인 · 결함 100만 개'(1.2 · 1.8 각 약 68MB): 읽기 · 검증 2.2 ~ 2.7초, 그리기 0.1초 안팎",
        "결함 점은 WebGL 로 그려 100만 개에서도 이동 · 확대가 164 fps 이상 (Intel Iris Xe, Chrome)",
        "파일은 Worker 에서 8MB 조각으로 읽어 화면이 멈추지 않음. 읽는 중에 [취소] 가능",
    ], "Big", M("Big", 0, 1), [
        ("읽기 시간", "읽기 · 검증 시간과 첫 그리기 시간"),
        ("지도", "100만 개를 한 번에 그립니다"),
    ], tip="메모리는 결함 100만 개에 JS 힙 약 180 ~ 250MB. WebGL 이 꺼진 브라우저는 느리게 그립니다", card_title="결함 100만 개")


def faq():
    s = new_slide()
    header(s, "내 데이터 · 부록", "FAQ · 문제 해결", [
        "도움말(?) 창에도 같은 내용이 있음",
        "예기치 않은 오류는 도움말 → 오류 기록에 이 기기에만 남음 (외부로 보내지 않음)",
        "데이터 백업 · 가져오기 · 전체 삭제는 설정 → 데이터",
    ])
    qa = [
        ("맵이 비어 보여요", "'읽지 못한 줄'을 펼쳐 사유를 보세요. DefectRecordSpec(1.8 은 Columns)에 XREL · YREL · XINDEX · YINDEX 가 있어야 합니다."),
        ("정상 파일인데 오류가 나요", "검증 규칙의 허용값이 내 장비와 다를 수 있습니다. 현장 검증 → 비교에서 B 초안을 만들어 재현 세트로 확인한 뒤 전환하세요."),
        ("pitch · 스크라이브를 판정 안 해요", "결함이 2,000개 미만이거나 다이마다 되풀이되는 구조가 없으면 판정하지 않습니다. 오검 대신 '참고'로 적습니다."),
        ("웨이퍼가 뒤집혀 보여요", "위쪽이 +Y 입니다. CoordinatesMirrored · InspectionOrientation 은 공개 자료로 의미를 확인하지 못해 적용하지 않습니다."),
        ("1.8 파일 크기가 이상해요", "SampleSize 가 1e5 보다 크면 nm, 아니면 µm 로 봅니다. 파일 · 맵 정의의 '1.8 단위'를 확인하세요."),
        ("두 파일 비교에서 공통이 적어요", "짝 거리(µm)를 장비 위치 반복 정밀도에 맞게 늘리세요. 맵 정의가 다르면 표 위에 경고가 나옵니다."),
        ("결함 이미지는요?", "TIFF · JPG 결함 이미지는 보여주지 않습니다. IMAGELIST 의 이미지 수만 읽습니다."),
        ("오프라인에서도 되나요?", "한 번 열면 앱 파일이 저장되어 오프라인으로 열리고, 마지막 파일도 다시 열립니다."),
    ]
    cw, ch = 6.05, 1.02
    for i, (q, a) in enumerate(qa):
        col, row = i % 2, i // 2
        x = 0.5 + col * (cw + 0.23)
        y = CY + row * (ch + 0.13)
        rbox(s, x, y, cw, ch)
        text(s, x + 0.15, y + 0.08, 0.4, 0.32, "Q", 13, True, BLUE)
        text(s, x + 0.5, y + 0.08, cw - 0.65, 0.32, q, 12, True)
        text(s, x + 0.5, y + 0.42, cw - 0.65, 0.56, a, 10, False, SUB)


def back():
    s = new_slide()
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = NAVY
    wafer_art(s, 6.67, 2.3, 1.35)
    text(s, 0, 4.4, 13.333, 0.6, NAME, 30, True, WHITE, PP_ALIGN.CENTER)
    text(s, 0, 5.05, 13.333, 0.4, "KLARF 1.2 · 1.8 · 맵 정의 검증 5가지 · 겹치기 · 두 파일 비교", 13, False, RGBColor(0xC9, 0xD3, 0xE0), PP_ALIGN.CENTER)
    text(s, 0, 5.7, 13.333, 0.6, [f"v{VERSION}   ·   만든 사람 배민혁   ·   MIT License   ·   © 2026",
                                  "포함: Pretendard (SIL OFL 1.1) · 예시 Klarf 와 화면은 모두 합성 데이터"],
         10, False, RGBColor(0x8A, 0x97, 0xA8), PP_ALIGN.CENTER)


def main():
    cover()            # 1
    toc()              # 2
    intro()            # 3
    install()          # 4
    screens()          # 5–6
    checks_overview()  # 7
    checks()           # 8–13
    views()            # 14–18
    flow_overview()    # 19
    verify()           # 20–23
    data()             # 24–26
    appendix()         # 27
    big()              # 28
    faq()              # 29
    back()             # 30
    assert state["n"] == TOTAL, state["n"]
    prs.save(OUT)
    print("saved", OUT)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
