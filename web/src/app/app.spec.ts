import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { App, COMPARISON_URL } from './app';
import { SAMPLE_REPORT } from './testing/sample-report';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  function page(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  async function answer(body: object | null, status = 200): Promise<void> {
    const request = http.expectOne(COMPARISON_URL);
    if (status === 200) {
      request.flush(body);
    } else {
      request.flush('not found', { status, statusText: 'Not Found' });
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('lists every row of the report', async () => {
    await answer(SAMPLE_REPORT);

    const lines = [...page().querySelectorAll('.row .line')].map((element) => element.textContent?.trim());
    expect(lines).toEqual(['Line 2', 'Line 3', 'Line 24']);
  });

  it('shows the first row next to its resources until another is chosen', async () => {
    await answer(SAMPLE_REPORT);

    expect(page().querySelector('#legacy-title + p')?.textContent).toContain('Line 2');
    expect(page().querySelector('.resource-meta a')?.getAttribute('href')).toBe(
      'https://example.org/fhir/Patient/28886',
    );
  });

  it('shows the stray space in a legacy value instead of hiding it', async () => {
    await answer(SAMPLE_REPORT);

    const values = [...page().querySelectorAll('td.value')].map((cell) => cell.textContent?.trim());
    expect(values).toContain('NOVAK␣');
  });

  it('switches to a rejected row and explains why it was rejected', async () => {
    await answer(SAMPLE_REPORT);

    const rows = page().querySelectorAll<HTMLButtonElement>('button.row');
    rows[2]?.click();
    fixture.detectChanges();

    expect(page().querySelector('.notice.error')?.textContent).toContain('MRN is empty');
    expect(page().querySelector('.empty')?.textContent).toContain('produced no resources');
  });

  it('explains how to produce the data when there is none yet', async () => {
    await answer(null, 404);

    expect(page().querySelector('[role="alert"]')?.textContent).toContain('npm start');
  });
});
