#!/usr/bin/env python3
"""Export vendor orders to xlsx.

Input JSON path via ORDERS_JSON_PATH
Filter vendorId via VENDOR_ID
Output xlsx bytes to stdout.
"""

import io
import json
import os
from openpyxl import Workbook


def main():
    orders_path = os.environ.get('ORDERS_JSON_PATH')
    vendor_id = os.environ.get('VENDOR_ID')
    if not orders_path or not vendor_id:
        raise SystemExit('ORDERS_JSON_PATH and VENDOR_ID required')

    with open(orders_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    rows = [o for o in (data.get('orders') or []) if o.get('vendorId') == vendor_id]

    wb = Workbook()
    ws = wb.active
    ws.title = 'orders'

    header = [
        '상품주문번호', '주문번호', '상품번호', '상품명', '옵션정보', '수량',
        '수취인명', '수취인 연락처', '주소',
        '택배사', '송장번호'
    ]
    ws.append(header)

    for o in rows:
        ws.append([
            o.get('productOrderNo') or '',
            o.get('orderNo') or '',
            o.get('productNo') or '',
            o.get('productName') or '',
            o.get('optionInfo') or '',
            o.get('qty') or 0,
            o.get('recipientName') or '',
            o.get('recipientPhone') or '',
            o.get('recipientAddress') or '',
            o.get('carrier') or '',
            o.get('trackingNumber') or '',
        ])

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    os.write(1, out.read())


if __name__ == '__main__':
    main()
