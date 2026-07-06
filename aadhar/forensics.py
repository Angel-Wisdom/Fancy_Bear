"""
Pixel-level document/image forensics.

Implements the techniques a real tamper-detection pipeline uses, as opposed to
metadata string-matching (which the Node side already does in
server/engines/forensics-engine.js):

  1. Error Level Analysis (ELA)      -> localized compression-error anomalies
  2. Copy-move (clone) detection      -> pasted/duplicated regions (ORB matching)
  3. Noise-inconsistency analysis     -> spliced-in content from a different source
  4. JPEG requantization signal       -> "this file has been opened & re-saved"

All of these work on decoded pixels, so they catch edits made in Photoshop,
GIMP, Canva, Paint, phone editing apps, or AI inpainting/generation tools --
regardless of what software wrote the EXIF tag (which can simply be stripped).

Returned findings use the same {severity, code, message, evidence} shape as
the rest of the verification engines, so they merge straight into the
existing `findings` array and render in the existing Findings tab.
"""

import base64
import io

import cv2
import numpy as np
from PIL import Image


# ---------------------------------------------------------------------------
# 1. Error Level Analysis
# ---------------------------------------------------------------------------
def error_level_analysis(pil_rgb, quality=90, block_size=16, outlier_z=3.0, edge_thresh=25.0):
    """
    Re-save the image at a known JPEG quality and diff it against the
    original. Untouched regions settle into a uniform, low compression
    error. Regions pasted/edited/generated at a different time or quality
    stand out as bright blocks in the diff.

    Blocks that contain a strong natural edge (text strokes, borders,
    high-contrast graphics -- exactly what fills most KYC documents) are
    excluded from the outlier scoring. Sharp edges always compress
    differently from flat regions regardless of tampering, so scoring them
    causes false positives on ordinary text-heavy scans. We still compute
    the full visual heatmap for the UI, but only score smooth/flat blocks
    for the anomaly ratio -- a genuine splice shows up there too, since the
    pasted region's *interior*, not just its border, carries the mismatched
    compression history.
    """
    buf = io.BytesIO()
    pil_rgb.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    resaved = np.asarray(Image.open(buf).convert("RGB")).astype(np.int16)
    original = np.asarray(pil_rgb).astype(np.int16)

    diff = np.abs(original - resaved)
    gray_diff = diff.mean(axis=2)

    gray = cv2.cvtColor(np.asarray(pil_rgb), cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    edge_mag = cv2.magnitude(gx, gy)

    max_diff = float(gray_diff.max()) if gray_diff.size else 0.0
    scale = 255.0 / max_diff if max_diff > 0 else 1.0
    ela_visual = np.clip(gray_diff * scale, 0, 255).astype(np.uint8)

    h, w = gray_diff.shape
    block_means, block_max_edge = [], []
    for y in range(0, max(h - block_size, 1), block_size):
        for x in range(0, max(w - block_size, 1), block_size):
            block_means.append(gray_diff[y:y + block_size, x:x + block_size].mean())
            block_max_edge.append(edge_mag[y:y + block_size, x:x + block_size].max())
    block_means = np.array(block_means) if block_means else np.array([0.0])
    block_max_edge = np.array(block_max_edge) if block_max_edge else np.array([0.0])

    non_edge = block_max_edge < edge_thresh
    scoring_blocks = block_means[non_edge] if non_edge.any() else block_means

    mean_val = float(scoring_blocks.mean())
    std_val = float(scoring_blocks.std())
    if std_val < 1e-6:
        outlier_ratio = 0.0
    else:
        z = (block_means - mean_val) / std_val
        outlier_ratio = float((z[non_edge] > outlier_z).sum()) / max(int(non_edge.sum()), 1)

    ela_rgb = cv2.applyColorMap(ela_visual, cv2.COLORMAP_INFERNO)
    ela_rgb = cv2.cvtColor(ela_rgb, cv2.COLOR_BGR2RGB)
    ela_img = Image.fromarray(ela_rgb)
    out = io.BytesIO()
    ela_img.save(out, "PNG")
    ela_b64 = base64.b64encode(out.getvalue()).decode()

    return {
        "flagged": outlier_ratio > 0.02,
        "outlierBlockRatio": round(outlier_ratio, 4),
        "meanErrorLevel": round(mean_val, 2),
        "elaImageBase64": ela_b64,
    }


# ---------------------------------------------------------------------------
# 2. Copy-move / clone detection
# ---------------------------------------------------------------------------
def detect_copy_move(gray, min_cluster_size=10, distance_ratio=0.08,
                      hamming_threshold=28, lowe_ratio=0.6, offset_bucket=8):
    """
    ORB keypoint matching *against itself* to find pasted/duplicated regions.

    The naive version of this (match keypoints, flag any far-apart match)
    false-positives constantly on ordinary photos, because real images are
    full of naturally repeating texture (skin, fabric, background, symmetric
    features). The signal that actually distinguishes a genuine copy-move
    forgery is geometric consistency: when a patch is copy-pasted elsewhere,
    *every* matched keypoint pair inside that patch shares the same
    translation offset (dx, dy). Scattered natural texture matches do not
    share a common offset. So we:

      1. Keep only strong matches (tight Hamming distance + Lowe ratio test)
         that are spatially far apart (not just adjacent, self-similar pixels).
      2. Bucket each match by its rounded (dx, dy) displacement vector.
      3. Only flag if one displacement bucket accumulates many independent
         matches -- that's a moved/duplicated region, not coincidence.
    """
    orb = cv2.ORB_create(nfeatures=2500)
    keypoints, descriptors = orb.detectAndCompute(gray, None)
    if descriptors is None or len(keypoints) < 10:
        return {"flagged": False, "matchCount": 0, "regions": []}

    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    matches = bf.knnMatch(descriptors, descriptors, k=3)

    h, w = gray.shape[:2]
    min_spatial_distance = distance_ratio * max(h, w)

    seen_pairs = set()
    candidates = []  # (dx_bucket, dy_bucket, pt1, pt2)
    for match_group in matches:
        real = [m for m in match_group if m.queryIdx != m.trainIdx]
        if len(real) < 2 or real[0].distance > hamming_threshold:
            continue
        # Lowe's ratio test: the best match must be clearly better than the
        # second-best, otherwise it's an ambiguous/ordinary texture match.
        if real[0].distance > lowe_ratio * real[1].distance:
            continue
        m = real[0]
        key = tuple(sorted((m.queryIdx, m.trainIdx)))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)

        pt1, pt2 = keypoints[m.queryIdx].pt, keypoints[m.trainIdx].pt
        spatial_dist = ((pt1[0] - pt2[0]) ** 2 + (pt1[1] - pt2[1]) ** 2) ** 0.5
        if spatial_dist <= min_spatial_distance:
            continue

        dx = round((pt2[0] - pt1[0]) / offset_bucket) * offset_bucket
        dy = round((pt2[1] - pt1[1]) / offset_bucket) * offset_bucket
        candidates.append(((dx, dy), pt1, pt2))

    buckets = {}
    for offset, pt1, pt2 in candidates:
        buckets.setdefault(offset, []).append((pt1, pt2))

    best_offset, best_pairs = (None, [])
    for offset, pairs in buckets.items():
        if len(pairs) > len(best_pairs):
            best_offset, best_pairs = offset, pairs

    match_count = len(best_pairs)
    regions = [
        {"from": [round(p1[0], 1), round(p1[1], 1)], "to": [round(p2[0], 1), round(p2[1], 1)]}
        for p1, p2 in best_pairs[:20]
    ]
    return {
        "flagged": match_count >= min_cluster_size,
        "matchCount": match_count,
        "dominantOffset": list(best_offset) if best_offset else None,
        "regions": regions,
    }


# ---------------------------------------------------------------------------
# 3. Noise-inconsistency analysis
# ---------------------------------------------------------------------------
def noise_inconsistency(gray, block_size=32, z_threshold=3.5, max_outlier_ratio=0.12):
    """
    Every capture source (camera sensor, scanner, screenshot, AI generator)
    leaves a distinct noise floor. Splice in content from elsewhere and the
    noise level of that patch usually doesn't match its surroundings.

    We look for a *small, localized cluster* of outlier blocks -- if the
    whole image is uniformly noisy/smooth, that's just image quality, not
    tampering, so a ratio above `max_outlier_ratio` is not flagged.
    """
    h, w = gray.shape
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    residual = cv2.absdiff(gray, blurred).astype(np.float32)

    block_stds, positions = [], []
    for y in range(0, max(h - block_size, 1), block_size):
        for x in range(0, max(w - block_size, 1), block_size):
            block = residual[y:y + block_size, x:x + block_size]
            block_stds.append(block.std())
            positions.append((x, y))

    if len(block_stds) < 4:
        return {"flagged": False, "outlierBlocks": [], "outlierRatio": 0.0, "globalStd": 0.0}

    block_stds = np.array(block_stds)
    mean_std, std_of_std = float(block_stds.mean()), float(block_stds.std())

    if std_of_std < 1e-6:
        return {"flagged": False, "outlierBlocks": [], "outlierRatio": 0.0, "globalStd": round(mean_std, 2)}

    z_scores = (block_stds - mean_std) / std_of_std
    outlier_idx = np.where(np.abs(z_scores) > z_threshold)[0]
    outlier_ratio = len(outlier_idx) / len(block_stds)

    outlier_blocks = [
        {"x": positions[i][0], "y": positions[i][1], "zScore": round(float(z_scores[i]), 2)}
        for i in outlier_idx[:20]
    ]

    return {
        "flagged": 0 < outlier_ratio <= max_outlier_ratio,
        "outlierBlocks": outlier_blocks,
        "outlierRatio": round(float(outlier_ratio), 4),
        "globalStd": round(mean_std, 2),
    }


# ---------------------------------------------------------------------------
# 4. JPEG requantization signal
# ---------------------------------------------------------------------------
def jpeg_requantization_signal(pil_img):
    """
    A clean, single-generation JPEG normally embeds one luma + one chroma
    quantization table. A file that was decoded, edited, and re-saved as
    JPEG (Photoshop, Canva export, WhatsApp re-share, etc.) often carries
    non-standard or duplicated quantization tables. This is a weak,
    low-confidence signal on its own -- useful as corroboration, not proof.
    """
    if pil_img.format != "JPEG" or not hasattr(pil_img, "quantization"):
        return {"applicable": False, "flagged": False}

    tables = pil_img.quantization or {}
    table_count = len(tables)
    return {"applicable": True, "flagged": table_count > 2, "tableCount": table_count}


# ---------------------------------------------------------------------------
# 5. Global noise-floor check (catches AI-generated & whole-image Paint edits)
# ---------------------------------------------------------------------------
def global_noise_floor(gray, edge_thresh=14.0, erode_px=7, flat_floor=0.15, min_samples=500):
    """
    ELA/copy-move/noise-inconsistency above are all *splice* detectors: they
    only fire when part of an image differs from the rest. A fully
    AI-generated image, or one drawn/filled entirely in Paint, has no such
    internal boundary -- the whole thing was produced the same way, so
    nothing looks "locally different."

    What DOES distinguish these from a real photo/scan is the noise floor.
    Every camera sensor and scanner leaves faint grain even in visually flat
    areas (skin, sky, a plain background). Paint's bucket-fill/shape tools
    and most AI generators produce genuinely flat regions with zero grain.

    We measure noise only inside low-gradient "interior" regions (eroded
    well away from any edge, so real edges/JPEG ringing don't contaminate
    the reading), and flag when that floor is suspiciously close to zero.

    Caveat (communicated in the finding message): this is most meaningful
    for photographic content (a face photo on an ID, a picture of a
    document). A very clean, high-quality scan of a plain printed form can
    legitimately have near-zero grain too, so this is a lower-confidence,
    corroborating signal -- not proof on its own.
    """
    gray_f = gray.astype(np.float32)
    gx = cv2.Sobel(gray_f, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray_f, cv2.CV_32F, 0, 1, ksize=3)
    edge_mag = cv2.magnitude(gx, gy)
    raw_interior = (edge_mag < edge_thresh).astype(np.uint8)
    interior_mask = cv2.erode(raw_interior, np.ones((erode_px, erode_px), np.uint8)).astype(bool)

    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    residual = cv2.absdiff(gray, blurred).astype(np.float32)
    interior_vals = residual[interior_mask]

    if interior_vals.size < min_samples:
        # Not enough flat, edge-free area to get a reliable reading (busy/
        # noisy image) -- inconclusive, so don't flag.
        return {"applicable": False, "flagged": False, "noiseFloor": None}

    noise_floor = float(interior_vals.std())
    return {
        "applicable": True,
        "flagged": noise_floor < flat_floor,
        "noiseFloor": round(noise_floor, 4),
        "sampleRatio": round(float(interior_mask.mean()), 4),
    }


# ---------------------------------------------------------------------------
# 6. Content-credentials (C2PA) marker scan
# ---------------------------------------------------------------------------
def content_credentials_scan(raw_bytes):
    """
    Many AI image generators and editing tools (Adobe Firefly/Photoshop
    generative fill, and a growing list of others under the C2PA coalition)
    embed a "Content Credentials" manifest (a JUMBF box) recording
    generation/edit history directly in the file. Unlike a strippable EXIF
    Software tag, this is a structured, purpose-built provenance record.

    This is a real, reliable signal *when present* -- but its absence
    proves nothing (most tools don't write it, and it can be stripped).
    Treat a hit as strong evidence; treat a miss as "no information."
    """
    markers = (b"c2pa", b"C2PA", b"application/c2pa", b"urn:c2pa", b"jumb\x00c2pa")
    found = [m.decode(errors="ignore") for m in markers if m in raw_bytes]
    return {"found": len(found) > 0, "markers": found}


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
def analyze(image_bytes):
    pil_img = Image.open(io.BytesIO(image_bytes))
    pil_img.load()
    pil_rgb = pil_img.convert("RGB")
    cv_img = cv2.cvtColor(np.array(pil_rgb), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

    ela = error_level_analysis(pil_rgb)
    clone = detect_copy_move(gray)
    noise = noise_inconsistency(gray)
    quant = jpeg_requantization_signal(pil_img)
    global_noise = global_noise_floor(gray)
    content_credentials = content_credentials_scan(image_bytes)

    findings = []
    if ela["flagged"]:
        findings.append({
            "severity": "high",
            "code": "pixel.ela_anomaly",
            "message": (
                f"Error Level Analysis found {ela['outlierBlockRatio'] * 100:.1f}% of image "
                "blocks with abnormal compression error, consistent with localized editing."
            ),
            "evidence": {"outlierBlockRatio": ela["outlierBlockRatio"], "meanErrorLevel": ela["meanErrorLevel"]},
        })
    if clone["flagged"]:
        findings.append({
            "severity": "critical",
            "code": "pixel.copy_move",
            "message": (
                f"Detected {clone['matchCount']} keypoint matches between distant regions of "
                "the same image, consistent with copy-paste (clone) forgery."
            ),
            "evidence": {"matchCount": clone["matchCount"], "regions": clone["regions"][:5]},
        })
    if noise["flagged"]:
        findings.append({
            "severity": "medium",
            "code": "pixel.noise_inconsistency",
            "message": (
                f"Localized noise pattern differs sharply from the rest of the image in "
                f"{noise['outlierRatio'] * 100:.1f}% of regions, which can indicate spliced-in content."
            ),
            "evidence": {"outlierRatio": noise["outlierRatio"], "globalStd": noise["globalStd"]},
        })
    if quant.get("flagged"):
        findings.append({
            "severity": "low",
            "code": "pixel.jpeg_requantization",
            "message": "JPEG quantization tables suggest this image was decoded and re-encoded from an already-compressed source.",
            "evidence": {"tableCount": quant["tableCount"]},
        })
    if global_noise["flagged"]:
        findings.append({
            "severity": "medium",
            "code": "pixel.no_sensor_noise",
            "message": (
                f"No natural sensor/scanner noise floor was detected anywhere in the image "
                f"(noise floor {global_noise['noiseFloor']}, expected camera/scan grain > {0.15}). "
                "This is consistent with a fully AI-generated image or content drawn/filled entirely "
                "in an editor rather than photographed or scanned -- though a very clean scan of a "
                "plain printed page can also read this way, so treat this as corroborating, not conclusive."
            ),
            "evidence": global_noise,
        })
    if content_credentials["found"]:
        findings.append({
            "severity": "critical",
            "code": "pixel.content_credentials_detected",
            "message": "This file embeds a C2PA Content Credentials manifest, which records AI-generation or edit history directly in the file.",
            "evidence": content_credentials,
        })

    return {
        "flagged": len(findings) > 0,
        "findings": findings,
        "ela": {"outlierBlockRatio": ela["outlierBlockRatio"], "meanErrorLevel": ela["meanErrorLevel"]},
        "elaImageBase64": ela["elaImageBase64"],
        "cloneDetection": {"matchCount": clone["matchCount"], "flagged": clone["flagged"], "regions": clone["regions"][:5]},
        "noiseAnalysis": {k: v for k, v in noise.items() if k != "outlierBlocks"},
        "quantization": quant,
        "globalNoiseFloor": global_noise,
        "contentCredentials": content_credentials,
    }
