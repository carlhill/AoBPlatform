import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { PracticesService } from './practices.service';
import {
  CreateAssignorDto,
  CreatePracticeDto,
  CreateProviderDto,
  CreateStaffDto,
  UpdateConfigDto,
} from './practices.dto';

function requireMatch(headerPracticeId: string | undefined, pathPracticeId: string): string {
  if (!headerPracticeId) throw new BadRequestException('x-practice-id header is required.');
  if (headerPracticeId !== pathPracticeId) {
    // RLS would return nothing anyway — reject loudly rather than confusingly.
    throw new BadRequestException('Practice scope mismatch.');
  }
  return pathPracticeId;
}

@Controller('practices')
export class PracticesController {
  constructor(private readonly practices: PracticesService) {}

  /** Practice creation is the one unscoped operation — it mints the scope. */
  @Post()
  create(@Body() dto: CreatePracticeDto) {
    return this.practices.create(dto);
  }

  @Get(':id')
  get(@Headers('x-practice-id') scope: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.practices.get(requireMatch(scope, id));
  }

  @Patch(':id/config')
  updateConfig(
    @Headers('x-practice-id') scope: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConfigDto,
  ) {
    return this.practices.updateConfig(requireMatch(scope, id), dto);
  }

  @Post(':id/staff')
  addStaff(
    @Headers('x-practice-id') scope: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStaffDto,
  ) {
    return this.practices.addStaff(requireMatch(scope, id), dto);
  }

  @Post(':id/providers')
  addProvider(
    @Headers('x-practice-id') scope: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProviderDto,
  ) {
    return this.practices.addProvider(requireMatch(scope, id), dto);
  }

  @Post(':id/assignors')
  addAssignor(
    @Headers('x-practice-id') scope: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAssignorDto,
  ) {
    return this.practices.addAssignor(requireMatch(scope, id), dto);
  }

  @Get(':id/go-live-checklist')
  checklist(@Headers('x-practice-id') scope: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.practices.goLiveChecklist(requireMatch(scope, id));
  }
}
