import { describe, expect, it } from 'vitest'
import { parseCsv, tierKey } from './reportData2'

describe('video export parsing', () => {
  it('reads quoted fields that contain commas, quotes and line breaks', () => {
    const csv = '﻿Video ID,Description,GMV Tier\r\n1,"Great, really ""great""\nsecond line",L4\r\n2,plain,L0\r\n'
    expect(parseCsv(csv)).toEqual([
      { 'Video ID': '1', Description: 'Great, really "great"\nsecond line', 'GMV Tier': 'L4' },
      { 'Video ID': '2', Description: 'plain', 'GMV Tier': 'L0' },
    ])
  })
  it('has no L0: L0, blank and unknown levels count as L1', () => {
    expect([tierKey('L0'), tierKey(''), tierKey(undefined), tierKey('L4'), tierKey('l7'), tierKey('None')]).toEqual(['l1', 'l1', 'l1', 'l4', 'l7', 'l1'])
  })
})
