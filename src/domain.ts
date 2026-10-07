export const sourceIds = ["scribd", "slideshare", "everand", "fable"] as const;
export type SourceId = (typeof sourceIds)[number];

export interface SourceSpec {
  readonly id: SourceId;
  readonly name: string;
  readonly hosts: readonly string[];
  readonly status: "ready" | "planned";
  readonly canLogin: boolean;
  readonly canDownload: boolean;
  readonly note: string;
}

export interface DownloadRequest {
  readonly url: string;
  readonly output?: string;
  readonly guest: boolean;
}

export const sources: readonly SourceSpec[] = [
  {
    id: "scribd",
    name: "Scribd",
    hosts: ["scribd.com", "www.scribd.com"],
    status: "ready",
    canLogin: true,
    canDownload: true,
    note: "Scribd 文档和嵌入链接，导出阅读器 PDF",
  },
  {
    id: "slideshare",
    name: "SlideShare",
    hosts: ["slideshare.net", "www.slideshare.net"],
    status: "planned",
    canLogin: false,
    canDownload: false,
    note: "待适配：优先验证获授权的原文件下载",
  },
  {
    id: "everand",
    name: "Everand",
    hosts: ["everand.com", "www.everand.com"],
    status: "planned",
    canLogin: false,
    canDownload: false,
    note: "待调研：仅考虑平台允许导出的内容，不移除 DRM",
  },
  {
    id: "fable",
    name: "Fable",
    hosts: ["fable.co", "www.fable.co"],
    status: "planned",
    canLogin: false,
    canDownload: false,
    note: "待调研：先确认可导出的内容和权限",
  },
];
