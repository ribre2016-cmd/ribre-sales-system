import json, re, webbrowser, traceback
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config_api_key.txt"
HTML_FILE = "sales_management_Ver12_5.html"
PORT = 8765

def read_api_key():
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text("ここにOpenAI_APIキーを入れる", encoding="utf-8")
        return ""
    key = CONFIG_PATH.read_text(encoding="utf-8").strip()
    if not key or "ここに" in key:
        return ""
    return key

def extract_json_text(text):
    text = (text or "").strip()
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass

    return {"reply": "AIの返答がJSON形式ではありませんでした。別の画像/鮮明なキャプチャで再読取してください。返答: " + text[:200]}

def build_sales_prompt(instruction, previous_result):
    prompt = """ユーザーが画面のルール欄・AIチャット欄に書いた指示だけを業務ルールとして使い、売上管理表に必要な項目をJSONで抽出してください。
ルール欄にない独自判断は最小限にしてください。
必ずJSONのみで返してください。

{
 "date":"YYYY-MM-DD",
 "shop":"販売先名",
 "sale_type":"小売 または 卸売",
 "item_name":"商品名または内容",
 "price":0,
 "fee":0,
 "memo":"補足",
 "reply":"ユーザーへの短い返答"
}

金額はカンマなしの数値。不明な項目は空文字または0。
"""
    return prompt

def build_purchase_prompt(instruction, previous_result):
    prompt = """ユーザーが画面のルール欄・AIチャット欄に書いた指示だけを業務ルールとして使い、仕入れ管理表に必要な項目をJSONで抽出してください。
ルール欄にない独自判断は最小限にしてください。
必ずJSONのみで返してください。

{
 "date":"YYYY-MM-DD",
 "vendor":"仕入先名",
 "purchase_type":"業者オークション または 業者仕入 または 店頭買取 または 出張買取 または その他",
 "item_name":"仕入内容",
 "qty":0,
 "cost":0,
 "expense":0,
 "shipping":0,
 "memo":"補足",
 "reply":"ユーザーへの短い返答"
}

金額はカンマなしの数値。不明な項目は空文字または0。
"""
    return prompt

def normalize_result(mode, result):
    if not isinstance(result, dict):
        result = {}

    if mode == "purchase":
        return {
            "date": result.get("date","") or "",
            "vendor": result.get("vendor","") or result.get("shop","") or "",
            "purchase_type": result.get("purchase_type","") or result.get("type","") or "業者仕入",
            "item_name": result.get("item_name","") or result.get("name","") or "",
            "qty": result.get("qty", result.get("quantity", 0)) or 0,
            "cost": result.get("cost", result.get("price", 0)) or 0,
            "expense": result.get("expense", result.get("fee", 0)) or 0,
            "shipping": result.get("shipping", 0) or 0,
            "memo": result.get("memo","") or "",
            "reply": result.get("reply","仕入候補を読み取りました。") or "仕入候補を読み取りました。"
        }

    return {
        "date": result.get("date","") or "",
        "shop": result.get("shop","") or result.get("vendor","") or "",
        "sale_type": result.get("sale_type","") or result.get("type","") or "小売",
        "item_name": result.get("item_name","") or result.get("name","") or "",
        "price": result.get("price", result.get("cost", 0)) or 0,
        "fee": result.get("fee", result.get("expense", 0)) or 0,
        "memo": result.get("memo","") or "",
        "reply": result.get("reply","読み取りました。") or "読み取りました。"
    }

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if urlparse(self.path).path == "/":
            self.send_response(302)
            self.send_header("Location","/"+HTML_FILE)
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/ai_extract":
            self.send_json({"ok":False,"error":"not found"},404)
            return

        try:
            api_key = read_api_key()
            if not api_key:
                self.send_json({"ok":False,"error":"config_api_key.txt にOpenAI APIキーを入れてください"},200)
                return

            if OpenAI is None:
                self.send_json({"ok":False,"error":"openaiライブラリが未インストールです。install_openai.batを実行してください"},200)
                return

            length = int(self.headers.get("Content-Length",0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            data_url = body.get("dataUrl","")
            instruction = body.get("instruction","")
            previous_result = body.get("previousResult",{})
            saved_rule = body.get("savedRule","")
            mode = body.get("mode","sales")

            if not data_url:
                self.send_json({"ok":False,"error":"画像データが送信されていません"},200)
                return

            prompt = build_purchase_prompt(instruction, previous_result) if mode == "purchase" else build_sales_prompt(instruction, previous_result)

            if saved_rule:
                prompt += "\n\n【ユーザーが画面に書いたAI読み取り指示】\n" + saved_rule + "\n上記の指示だけを業務ルールとして最優先で適用してください。禁止ルールに書かれた項目や数字は採用しないでください。"

            client = OpenAI(api_key=api_key)

            # Use a broadly available model that supports images and PDF/file inputs.
            model_name = "gpt-4.1"

            content = [{"type":"input_text","text":prompt}]

            if data_url.startswith("data:application/pdf"):
                content.append({
                    "type":"input_file",
                    "filename":"uploaded.pdf",
                    "file_data":data_url
                })
            else:
                content.append({
                    "type":"input_image",
                    "image_url":data_url
                })

            response = client.responses.create(
                model=model_name,
                input=[{
                    "role":"user",
                    "content":content
                }]
            )

            text = getattr(response,"output_text","") or ""
            result = normalize_result(mode, extract_json_text(text))
            self.send_json({"ok":True,"result":result,"appliedRule":saved_rule},200)

        except Exception as e:
            print("AI_ERROR:", str(e))
            traceback.print_exc()
            self.send_json({"ok":False,"error":"AI読み取りエラー: " + str(e)},200)

    def send_json(self,data,status=200):
        b=json.dumps(data,ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(b)))
        self.end_headers()
        self.wfile.write(b)

if __name__=="__main__":
    url=f"http://localhost:{PORT}/{HTML_FILE}"
    print("==========================================")
    print("売上管理ツール Ver12.5 ローカル版を起動しました")
    print("ブラウザURL:", url)
    print("終了するときはこの黒い画面を閉じてください")
    print("==========================================")
    webbrowser.open(url)
    ThreadingHTTPServer(("127.0.0.1",PORT),Handler).serve_forever()
