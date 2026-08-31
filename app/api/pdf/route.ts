import { NextResponse } from "next/server";

const allowedHosts = new Set([
  "www.thulegroup.com",
  "hmsnetworks.blob.core.windows.net",
  "www.engcongroup.com",
  "storage.mfn.se",
]);

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url");
  if (!source) return NextResponse.json({ error: "Missing PDF URL." }, { status: 400 });

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return NextResponse.json({ error: "Invalid PDF URL." }, { status: 400 });
  }
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    return NextResponse.json({ error: "This PDF host is not in the catalogue." }, { status: 403 });
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { accept: "application/pdf" },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `The publisher returned ${response.status}.` },
        { status: 502 },
      );
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || !allowedHosts.has(finalUrl.hostname)) {
      return NextResponse.json({ error: "The publisher redirected outside the catalogue." }, { status: 502 });
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/pdf")) {
      return NextResponse.json({ error: "The publisher did not return a PDF." }, { status: 502 });
    }

    const headers = new Headers({
      "content-type": "application/pdf",
      "cache-control": "public, max-age=3600",
    });
    const contentLength = response.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);

    // Stream large reports instead of holding the complete file in the worker.
    return new Response(response.body, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not fetch the PDF." },
      { status: 502 },
    );
  }
}
