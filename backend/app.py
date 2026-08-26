"""
app.py
------
واجهة API بسيطة (Flask) تستقبل صورة هوية طالب وترجّع الاسم المستخرج.

التشغيل:
    pip install -r requirements.txt
    python3 app.py

الاستدعاء:
    curl -X POST -F "id_card=@path/to/image.jpg" http://localhost:5000/extract-name
"""

import os
import tempfile

from flask import Flask, request, jsonify
from flask_cors import CORS

from extract_name import extract_full_name, extract_full_name_arabic
import pytesseract

app = Flask(__name__)
CORS(app)

ALLOWED_EXT = {"jpg", "jpeg", "png"}


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT


@app.route("/extract-name", methods=["POST"])
def extract_name_endpoint():
    if "id_card" not in request.files:
        return jsonify({"error": "لم يتم إرفاق صورة تحت الحقل id_card"}), 400

    file = request.files["id_card"]
    if file.filename == "" or not allowed_file(file.filename):
        return jsonify({"error": "صيغة الصورة غير مدعومة (jpg/jpeg/png فقط)"}), 400

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        name_en = extract_full_name(tmp_path)
    except Exception:
        name_en = None

    try:
        name_ar = extract_full_name_arabic(tmp_path)
    except pytesseract.TesseractError:
        name_ar = None
    except Exception:
        name_ar = None
    finally:
        os.remove(tmp_path)

    if name_en or name_ar:
        return jsonify({"name_en": name_en, "name_ar": name_ar})
    return jsonify({"error": "تعذر استخراج الاسم، الرجاء إدخاله يدويًا"}), 422


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
