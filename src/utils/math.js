export function sqrDist(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return dx * dx + dy * dy;
}

export function distToSegmentSquared(p, v, w) {
    const l2 = sqrDist(v, w);
    if (l2 === 0) return sqrDist(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return sqrDist(p, projection);
}

export function rotatePoint(point, center, angle) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const rotatedX = dx * cosA - dy * sinA + center.x;
    const rotatedY = dx * sinA + dy * cosA + center.y;
    return { x: rotatedX, y: rotatedY };
}