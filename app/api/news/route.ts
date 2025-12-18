// src/app/api/news/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');

  if (!query) {
    return NextResponse.json({ items: [] });
  }

  try {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    const apiUrl = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=5&sort=sim`;

    const response = await fetch(apiUrl, {
      headers: {
        'X-Naver-Client-Id': clientId!,
        'X-Naver-Client-Secret': clientSecret!,
      },
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ items: [] }, { status: 500 });
  }
}