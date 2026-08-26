"""
extract_name.py
----------------
يستخرج اسم الطالب الكامل (بالإنجليزي والعربي) من صورة هوية جامعية عراقية
عبر البحث عن السطر الذي يبدأ بكلمة "Name" أو "الأسم" واستخراج ما بعد ":".

الاستخدام:
    python3 extract_name.py path/to/id_card.jpg
"""

import re
import cv2
import pytesseract


def preprocess(image_path: str):
    """تحسين الصورة قبل تمريرها لمحرك OCR لزيادة دقة القراءة."""
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"تعذر فتح الصورة: {image_path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    gray = cv2.bilateralFilter(gray, 9, 75, 75)
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )
    return thresh


def _locate_label_word(gray, pattern: str, lang: str, psm: str = "11"):
    """
    يبحث عن كلمة تطابق pattern (regex) داخل نص الصورة بلغة lang،
    ويرجّع إحداثياتها (left, top, width, height) لأول تطابق.
    """
    data = pytesseract.image_to_data(
        gray, lang=lang, config=f"--psm {psm}", output_type=pytesseract.Output.DICT
    )
    for i, word in enumerate(data["text"]):
        if re.search(pattern, word.strip(), re.IGNORECASE):
            return (
                data["left"][i],
                data["top"][i],
                data["width"][i],
                data["height"][i],
            )
    return None


def _locate_name_word(gray):
    return _locate_label_word(gray, r"^name[:\-]?$", lang="eng")


def extract_full_name(image_path: str) -> str | None:
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"تعذر فتح الصورة: {image_path}")

    gray_full = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    box = _locate_name_word(gray_full)

    if box is not None:
        x, y, w, hgt = box
        img_h, img_w = gray_full.shape
        pad_y = int(hgt * 0.25)
        x1 = max(0, x)
        y1 = max(0, y - pad_y)
        x2 = min(img_w, x + int(hgt * 22))
        y2 = min(img_h, y + hgt + pad_y)
        line = gray_full[y1:y2, x1:x2]
        line = cv2.resize(line, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
        line = cv2.bilateralFilter(line, 9, 75, 75)
        text = pytesseract.image_to_string(line, lang="eng", config="--psm 7")
    else:
        text = pytesseract.image_to_string(gray_full, lang="eng", config="--psm 6")

    for line_text in text.splitlines():
        match = re.search(r"name\s*[:\-]?\s*(.+)", line_text.strip(), re.IGNORECASE)
        if match:
            name = match.group(1).strip()
            name = re.sub(r"[^A-Za-z .'\-]", "", name).strip()
            if len(name) >= 3:
                return name

    return None


def extract_full_name_arabic(image_path: str) -> str | None:
    """
    يستخرج الاسم بالعربي (حقل "الأسم:").

    يتطلب تثبيت حزمة اللغة العربية لـ Tesseract:
        sudo apt-get install tesseract-ocr-ara
    """
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"تعذر فتح الصورة: {image_path}")

    gray_full = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    box = _locate_label_word(gray_full, r"اسم", lang="ara")

    if box is None:
        return None

    x, y, w, hgt = box
    img_h, img_w = gray_full.shape
    pad_y = int(hgt * 0.35)
    x1 = 0
    x2 = min(img_w, x + w)
    y1 = max(0, y - pad_y)
    y2 = min(img_h, y + hgt + pad_y)

    line = gray_full[y1:y2, x1:x2]
    line = cv2.resize(line, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    line = cv2.bilateralFilter(line, 9, 75, 75)
    text = pytesseract.image_to_string(line, lang="ara", config="--psm 7").strip()

    text = re.sub(r"الأ?اسم", "", text)
    text = text.strip(" :\n")
    return text or None
