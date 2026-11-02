/** Claude takes pictures up to 5 MB, which is this many bytes before base64 encoding. */
const MAX_PICTURE_BYTES = 3_750_000;
/** A bigger picture is redrawn this long on its longest side, which is as much as Claude looks at. */
const MAX_SIDE = 1568;

/** A picture, base64-encoded, redrawn smaller first when it's too big to send. */
export async function readPicture(file: Blob): Promise<{ mediaType: string; data: string }> {
  const fitting =
    file.size > MAX_PICTURE_BYTES && typeof createImageBitmap === 'function' ? await shrink(file) : file;
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(fitting);
  });
  const comma = url.indexOf(',');
  return {
    mediaType: /^data:([^;,]+)/.exec(url)?.[1] ?? fitting.type,
    data: url.slice(comma + 1),
  };
}

async function shrink(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/png' });
}
