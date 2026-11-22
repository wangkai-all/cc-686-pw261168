"""Generate the three local inspection scenarios used by the app.

Deterministic (fixed seed). Outputs CSV + manifest into public/data/.
Run from the repo root:  python3 -I scripts/gen_data.py
"""
import csv, json, math, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data")
os.makedirs(OUT, exist_ok=True)
rng = random.Random(20261122)


def r2(v):
    return None if v is None else round(v + 0.0, 2)


def mirrored_cluster(cx, cy, n, sd, batch, prefix, start):
    """n points symmetric about (cx, cy): the cluster mean is exact even after
    rounding (paired +dx/-dx and +dy/-dy)."""
    rows = []
    idx = start
    for _ in range(n // 2):
        dx = rng.gauss(0.0, sd[0])
        dy = rng.gauss(0.0, sd[1])
        w = round(rng.uniform(0.6, 3.0), 2)
        for sx, sy in ((1, 1), (-1, -1)):
            rows.append(dict(
                id=f"{prefix}-{idx:03d}", batch=batch,
                length=r2(cx + sx * dx), width=r2(cy + sy * dy),
                length_unit="mm", width_unit="mm", weight=w))
            idx += 1
    if n % 2:
        rows.append(dict(
            id=f"{prefix}-{idx:03d}", batch=batch, length=r2(cx), width=r2(cy),
            length_unit="mm", width_unit="mm", weight=round(rng.uniform(0.8, 2.2), 2)))
        idx += 1
    return rows, idx


# ---------------------------------------------------------------- 1. bimodal
# A: clusters at (112,72) and (148,108)  -> positive diagonal
# B: clusters at (112,108) and (148,72) -> negative diagonal
# Each cluster carries exactly mass 10 in both batches, so both weighted batch
# means are (130, 90) mm.  Counts differ (44 vs 64) on purpose.
rows = []
idx = 1
for (cx, cy), n, note in (((112.0, 72.0), 22, "簇 A1 · 负偏差"), ((148.0, 108.0), 22, "簇 A2 · 正偏差")):
    part, idx = mirrored_cluster(cx, cy, n, (4.2, 3.6), "A", "BIM-A", idx)
    for r in part:
        r["note"] = note
    rows += part
for (cx, cy), n, note in (((112.0, 108.0), 32, "簇 B1 · 正偏差"), ((148.0, 72.0), 32, "簇 B2 · 负偏差")):
    part, idx = mirrored_cluster(cx, cy, n, (4.2, 3.6), "B", "BIM-B", idx)
    for r in part:
        r["note"] = note
    rows += part
# equal mass per cluster (10 each) for both batches
for batch in ("A", "B"):
    for note in sorted({r["note"] for r in rows if r["batch"] == batch}):
        grp = [r for r in rows if r["batch"] == batch and r["note"] == note]
        s = sum(r["weight"] for r in grp)
        for r in grp:
            r["weight"] = round(r["weight"] * 10.0 / s, 6)
bimodal = sorted(rows, key=lambda r: (r["batch"], r["id"]))


# ---------------------------------------------------------------- 2. units
# Same physical frame, B recorded with cm, a cm/mm mixture and inches.
def unit_cloud(n, cx, cy, sdx, sdy):
    out = []
    for _ in range(n):
        out.append((cx + rng.gauss(0, sdx), cy + rng.gauss(0, sdy),
                    round(max(0.4, rng.gauss(1.6, 0.55)), 2)))
    return out


rows = []
for i, (x, y, w) in enumerate(unit_cloud(52, 128.0, 84.0, 7.0, 4.8), 1):
    rows.append(dict(id=f"UNI-A-{i:03d}", batch="A", length=round(x, 1), width=round(y, 1),
                     length_unit="mm", width_unit="mm", weight=w, note="mm 量具"))
b_rows = unit_cloud(48, 128.6, 84.7, 7.0, 4.8)
for i, (x, y, w) in enumerate(b_rows, 1):
    if i <= 32:
        rows.append(dict(id=f"UNI-B-{i:03d}", batch="B", length=round(x / 10, 4), width=round(y / 10, 4),
                         length_unit="cm", width_unit="cm", weight=w, note="cm 量具"))
    elif i <= 40:
        rows.append(dict(id=f"UNI-B-{i:03d}", batch="B", length=round(x / 10, 4), width=round(y, 1),
                         length_unit="cm", width_unit="mm", weight=w, note="混合量具：长 cm / 宽 mm"))
    else:
        rows.append(dict(id=f"UNI-B-{i:03d}", batch="B", length=round(x / 25.4, 4), width=round(y / 25.4, 4),
                         length_unit="in", width_unit="in", weight=w, note="in 量具"))
units = sorted(rows, key=lambda r: (r["batch"], r["id"]))


# ---------------------------------------------------------------- 3. offset
# B shifted +8 mm in width; outliers, missing values, a zero-weight record.
def offset_cloud(n, cx, cy):
    out = []
    for _ in range(n):
        x = min(158.5, max(101.5, cx + rng.gauss(0, 7.5)))
        y = min(111.0, max(59.5, cy + rng.gauss(0, 4.7)))
        out.append((x, y, round(max(0.4, rng.gauss(1.5, 0.5)), 2)))
    return out


rows = []
for batch, cy in (("A", 82.0), ("B", 90.0)):
    for i, (x, y, w) in enumerate(offset_cloud(44, 126.0, cy), 1):
        rows.append(dict(id=f"OFF-{batch}-{i:03d}", batch=batch, length=round(x, 1), width=round(y, 1),
                         length_unit="mm", width_unit="mm", weight=w, note="常规抽检"))
rows += [
    dict(id="OFF-A-045", batch="A", length=205.0, width=80.0, length_unit="mm", width_unit="mm",
         weight=2.4, note="超程：长度量具滑移"),
    dict(id="OFF-B-045", batch="B", length=126.0, width=128.0, length_unit="mm", width_unit="mm",
         weight=2.0, note="超程：宽度翻边"),
    dict(id="OFF-A-046", batch="A", length=None, width=83.0, length_unit="mm", width_unit="mm",
         weight=1.7, note="缺测：长度未记录"),
    dict(id="OFF-B-046", batch="B", length=125.5, width=None, length_unit="mm", width_unit="mm",
         weight=1.3, note="缺测：宽度未记录"),
    dict(id="OFF-A-047", batch="A", length=123.0, width=81.0, length_unit="mm", width_unit="mm",
         weight=0, note="权重无效：复核权重为 0"),
]
offset = sorted(rows, key=lambda r: (r["batch"], r["id"]))

FIELDS = ["id", "batch", "length", "width", "length_unit", "width_unit", "weight", "note"]

def write_csv(name, rows):
    path = os.path.join(OUT, name)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in FIELDS})
    return path

write_csv("bimodal.csv", bimodal)
write_csv("units.csv", units)
write_csv("offset.csv", offset)


def weighted_mean(rows, batch):
    rr = [r for r in rows if r["batch"] == batch and r["length"] is not None
          and r["width"] is not None and r["weight"] > 0]
    sw = sum(r["weight"] for r in rr)
    return (sum(r["length"] * r["weight"] for r in rr) / sw,
            sum(r["width"] * r["weight"] for r in rr) / sw, len(rr), sw)


manifest = {
    "version": 1,
    "generatedBy": "scripts/gen_data.py",
    "rangeUnit": "mm",
    "scenarios": [
        {
            "id": "bimodal",
            "title": "同均值 · 双峰错位",
            "tagline": "两批加权均值完全相同，但两个峰沿相反对角线摆放。",
            "file": "bimodal.csv",
            "range": {"lengthMin": 95, "lengthMax": 165, "widthMin": 55, "widthMax": 125},
            "batches": [
                {"key": "A", "label": "批次 A · 上午班"},
                {"key": "B", "label": "批次 B · 下午班"},
            ],
            "notes": [
                "A 的两簇位于 (112, 72) 与 (148, 108) mm，沿正对角线排列。",
                "B 的两簇位于 (112, 108) 与 (148, 72) mm，沿负对角线排列。",
                "每批两簇质量各为 10，因此两批的加权均值都精确等于 (130, 90) mm。",
                "两批样本数 44 / 64 不同；归一化后只比较形状，不把数量差当分布差。",
                "均值差接近 0，但二维分布形状不同，最小搬运代价仍显著大于 0。",
            ],
            "checks": {"equalWeightedMeans": True, "expectZeroCost": False},
        },
        {
            "id": "units",
            "title": "单位混记 · 同一物理分布",
            "tagline": "B 批以 cm、in 以及 cm/mm 混合单位记录，先换算再比较。",
            "file": "units.csv",
            "range": {"lengthMin": 100, "lengthMax": 160, "widthMin": 58, "widthMax": 112},
            "batches": [
                {"key": "A", "label": "批次 A · mm 量具"},
                {"key": "B", "label": "批次 B · 混合量具"},
            ],
            "notes": [
                "A 批全部用 mm；B 批前 32 条用 cm，接下来 8 条长用 cm、宽用 mm，最后 8 条用 in。",
                "页面按每行单位换算到 mm，再由页面设定的轴比例换算为分析单位。",
                "若直接比较原始数字，B 的长宽数值会小一个数量级；对齐单位后两批形状接近。",
            ],
            "checks": {"expectRawUnitsMismatch": True},
        },
        {
            "id": "offset",
            "title": "宽度偏移 · 含特殊样本",
            "tagline": "B 批宽度整体偏移 +8 mm；另含超程、缺测与零权重记录。",
            "file": "offset.csv",
            "range": {"lengthMin": 100, "lengthMax": 160, "widthMin": 58, "widthMax": 112},
            "batches": [
                {"key": "A", "label": "批次 A · 基准"},
                {"key": "B", "label": "批次 B · 偏移"},
            ],
            "notes": [
                "两批常规样本的中心约在 (126, 82) 与 (126, 90) mm，宽度方向约 +8 mm。",
                "OFF-A-045 长度 205 mm、OFF-B-045 宽度 128 mm 超出名义量程；可扩展网格纳入或明确排除。",
                "OFF-A-046 / OFF-B-046 各缺一个坐标；缺测样本不生成网格位置，不参与运输距离。",
                "OFF-A-047 权重为 0，作为无效权重单列。",
                "默认「排除超程」只比较量程内样本，并显示被排除的数量与权重。",
            ],
            "checks": {"expectWidthOffsetMm": 8},
        },
    ],
}
with open(os.path.join(OUT, "scenarios.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print("wrote", OUT)
for name, data in (("bimodal", bimodal), ("units", units), ("offset", offset)):
    print(name, len(data), "rows")
    for b in ("A", "B"):
        rr = [r for r in data if r["batch"] == b]
        print(" ", b, len(rr), "records")
