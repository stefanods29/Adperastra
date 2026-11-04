import { describe, expect, it } from "vitest";
import {
  canMountDiskImage,
  diskImageKindFromName,
  isAbsoluteImagePath,
  isSourceStamp,
  validateMountRequest,
  validateMountResult,
  type MountRequest,
} from "../services/diskImages";

const stamp = {
  path_key: "C:\\images\\disk.iso",
  volume_id: "00112233",
  file_id: "0011223344556677",
  modified_ticks: "100",
  size_bytes: 1024,
};

describe("disk image contracts", () => {
  it("accepts only absolute image paths", () => {
    expect(isAbsoluteImagePath("C:\\images\\disk.iso")).toBe(true);
    expect(isAbsoluteImagePath("\\\\server\\share\\disk.vhdx")).toBe(true);
    expect(isAbsoluteImagePath("relative\\disk.iso")).toBe(false);
    expect(isAbsoluteImagePath("C:\\images\\..\\disk.iso")).toBe(false);
    expect(isAbsoluteImagePath("")).toBe(false);
  });

  it("refuses a writable request before Rust is called", () => {
    const request = {
      path: "C:\\images\\disk.iso",
      readonly: false,
    } as unknown as MountRequest;
    expect(() => validateMountRequest(request)).toThrow("disk.denied");
    const relative = {
      path: "disk.iso",
      readonly: true,
    } as MountRequest;
    expect(() => validateMountRequest(relative)).toThrow("disk.unsupported");
    const normalized = validateMountRequest({
      path: "C:\\images\\disk.iso",
      readonly: true,
    });
    expect(normalized.allow_elevation).toBe(false);
    expect(normalized.readonly).toBe(true);
  });

  it("validates source stamps with the producer widths", () => {
    expect(isSourceStamp(stamp)).toBe(true);
    expect(isSourceStamp({ ...stamp, volume_id: "123" })).toBe(false);
    expect(isSourceStamp({ ...stamp, file_id: "xyz" })).toBe(false);
    expect(isSourceStamp({ ...stamp, size_bytes: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
  });

  it("does not claim a raw img is a disk family", () => {
    expect(diskImageKindFromName("disk.iso")).toBe("iso");
    expect(diskImageKindFromName("disk.VHDX")).toBe("vhdx");
    expect(diskImageKindFromName("disk.img")).toBeNull();
    expect(canMountDiskImage("disk.img")).toBe(true);
    expect(canMountDiskImage("disk.zip")).toBe(false);
  });

  it("rejects a native record that claims to be writable", () => {
    const record = {
      mount_id: "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
      source: stamp,
      kind: "iso",
      volume_roots: ["F:\\"],
      physical_path: "\\\\.\\PhysicalDrive4",
      readonly: false,
      owned: true,
      state: "mounted",
      brokered: false,
    };
    expect(() =>
      validateMountResult({ mount: record, requires_elevation: false }),
    ).toThrow("disk.unavailable");
    const valid = validateMountResult({
      mount: { ...record, readonly: true },
      requires_elevation: false,
    });
    expect(valid.mount?.volume_roots).toEqual(["F:\\"]);
    expect(valid.mount?.readonly).toBe(true);
  });
});
